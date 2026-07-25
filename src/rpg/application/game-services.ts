import { achievements, catalogItems, jobs, travelLocations } from "../data/catalog";
import type { CatalogItem, Family, GameState, InventoryEntry, PlayerProfile, Requirement, TelegramUserId } from "../domain/types";
import { GAME_BALANCE } from "../config/game-balance";
import { createId } from "../utils/ids";
import { EconomyService } from "./economy-service";
import { PlayerService, type TelegramIdentity } from "./player-service";

export class GameServices {
  private readonly economy = new EconomyService();
  private readonly players = new PlayerService();
  private readonly catalogById = new Map(catalogItems.map((item) => [item.id, item]));

  ensurePlayer(state: GameState, identity: TelegramIdentity, now: string): PlayerProfile {
    return this.players.ensurePlayer(state.players, identity, now);
  }

  buyItem(state: GameState, identity: TelegramIdentity, itemId: string, now: string): CatalogItem {
    const player = this.ensurePlayer(state, identity, now);
    this.assertActive(player);

    const item = this.getCatalogItem(itemId);
    this.assertRequirements(player, this.getPlayerFamily(state, player), item.requirements);

    if (player.level < item.level) {
      throw new Error(`Покупка откроется на ${item.level} уровне`);
    }

    this.economy.debitPlayer(player, item.price, `purchase:${item.id}`, state.ledger, now);
    this.addInventoryItem(player.inventory, item.id, now);
    this.syncOwnershipIndexes(player, item);
    const family = this.getPlayerFamily(state, player);
    if (family && item.assetValue > 0) {
      this.addInventoryItem(family.inventory, item.id, now);
      family.stats.purchases += 1;
      family.stats.totalSpent += item.price;
      this.recalculateFamilyLevel(family, now);
    }
    this.players.addXp(player, Math.max(1, Math.floor(item.price / 1_000)), now);

    state.stats.purchases += 1;
    return item;
  }

  setJob(state: GameState, identity: TelegramIdentity, jobId: string, now: string): { title: string } {
    const player = this.ensurePlayer(state, identity, now);
    this.assertActive(player);

    const job = jobs.find((candidate) => candidate.id === jobId);
    if (!job) {
      throw new Error("Работа не найдена");
    }

    if (player.level < job.minLevel) {
      throw new Error(`Работа доступна с ${job.minLevel} уровня`);
    }

    this.assertRequirements(player, this.getPlayerFamily(state, player), job.requirements);
    player.jobId = job.id;
    player.updatedAt = now;

    return { title: job.title };
  }

  quitJob(state: GameState, identity: TelegramIdentity, now: string): void {
    const player = this.ensurePlayer(state, identity, now);
    this.assertActive(player);
    player.jobId = undefined;
    player.updatedAt = now;
  }

  work(state: GameState, identity: TelegramIdentity, jobId: string | undefined, now: string): { title: string; payout: number; xp: number } {
    const player = this.ensurePlayer(state, identity, now);
    this.assertActive(player);

    const selectedJobId = jobId ?? player.jobId;
    if (!selectedJobId) {
      throw new Error("Сначала выберите профессию через /job job_courier");
    }

    const job = jobs.find((candidate) => candidate.id === selectedJobId);
    if (!job) {
      throw new Error("Работа не найдена");
    }

    if (player.level < job.minLevel) {
      throw new Error(`Работа доступна с ${job.minLevel} уровня`);
    }

    this.assertRequirements(player, this.getPlayerFamily(state, player), job.requirements);

    if (player.energy < job.energyCost) {
      throw new Error("Недостаточно энергии");
    }

    const lastWorkedAt = player.lastWorkedAt ? Date.parse(player.lastWorkedAt) : 0;
    const cooldownMs = job.cooldownSeconds * 1_000;
    if (lastWorkedAt > 0 && Date.parse(now) - lastWorkedAt < cooldownMs) {
      throw new Error("Работа еще на перезарядке");
    }

    player.energy -= job.energyCost;
    player.lastWorkedAt = now;
    this.economy.creditPlayer(player, job.payout, `job:${job.id}`, state.ledger, now);
    this.players.addXp(player, job.xp, now);
    const family = this.getPlayerFamily(state, player);
    if (family) {
      family.capital += Math.floor(job.payout * 0.15);
      family.xp += Math.floor(job.xp * 0.2);
      family.stats.jobsCompleted += 1;
      family.stats.totalEarned += job.payout;
      this.recalculateFamilyLevel(family, now);
    }
    this.tryGrantAchievement(state, player, "ach_first_job", now);
    state.stats.jobsCompleted += 1;

    return { title: job.title, payout: job.payout, xp: job.xp };
  }

  claimDailyReward(state: GameState, identity: TelegramIdentity, now: string): { reward: number; xp: number } {
    const player = this.ensurePlayer(state, identity, now);
    this.assertActive(player);

    const lastClaim = player.dailyRewardClaimedAt ? Date.parse(player.dailyRewardClaimedAt) : 0;
    const minDelayMs = GAME_BALANCE.antiAbuse.dailyRewardHours * 60 * 60 * 1_000;
    if (lastClaim > 0 && Date.parse(now) - lastClaim < minDelayMs) {
      throw new Error("Ежедневная награда уже получена");
    }

    player.dailyRewardClaimedAt = now;
    this.economy.creditPlayer(player, GAME_BALANCE.economy.dailyReward, "daily_reward", state.ledger, now);
    this.players.addXp(player, GAME_BALANCE.economy.dailyRewardXp, now);
    state.stats.dailyRewards += 1;

    return { reward: GAME_BALANCE.economy.dailyReward, xp: GAME_BALANCE.economy.dailyRewardXp };
  }

  createProposal(state: GameState, proposer: TelegramIdentity, targetId: TelegramUserId, chatId: number, now: string): string {
    const proposerPlayer = this.ensurePlayer(state, proposer, now);
    this.assertActive(proposerPlayer);

    if (proposerPlayer.id === targetId) {
      throw new Error("Нельзя сделать предложение самому себе");
    }

    if (proposerPlayer.familyId) {
      throw new Error("Вы уже состоите в семье");
    }

    const duplicate = Object.values(state.marriageProposals).find(
      (proposal) => proposal.proposerId === proposerPlayer.id && proposal.targetId === targetId
    );
    if (duplicate) {
      throw new Error("Предложение уже отправлено");
    }

    const id = createId("proposal");
    state.marriageProposals[id] = {
      id,
      proposerId: proposerPlayer.id,
      targetId,
      chatId,
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + GAME_BALANCE.family.proposalTtlSeconds * 1_000).toISOString()
    };

    return id;
  }

  acceptProposal(state: GameState, target: TelegramIdentity, proposalId: string, now: string): Family {
    const targetPlayer = this.ensurePlayer(state, target, now);
    const proposal = state.marriageProposals[proposalId];
    if (!proposal || proposal.targetId !== targetPlayer.id || Date.parse(proposal.expiresAt) < Date.parse(now)) {
      throw new Error("Предложение не найдено или истекло");
    }

    const proposer = state.players[String(proposal.proposerId)];
    if (!proposer) {
      throw new Error("Автор предложения не найден");
    }

    if (proposer.familyId || targetPlayer.familyId) {
      throw new Error("Один из игроков уже состоит в семье");
    }

    const family: Family = {
      id: createId("family"),
      partnerIds: [proposer.id, targetPlayer.id],
      love: GAME_BALANCE.family.startingLove,
      level: GAME_BALANCE.family.startingLevel,
      xp: 0,
      capital: proposer.balance + targetPlayer.balance,
      title: "Новая семья",
      inventory: [],
      achievements: [],
      travelIds: [],
      stats: {
        jobsCompleted: 0,
        purchases: 0,
        travels: 0,
        giftsSent: 0,
        totalEarned: 0,
        totalSpent: 0
      },
      weddingDate: now,
      createdAt: now,
      updatedAt: now
    };

    proposer.familyId = family.id;
    targetPlayer.familyId = family.id;
    proposer.updatedAt = now;
    targetPlayer.updatedAt = now;
    state.families[family.id] = family;
    delete state.marriageProposals[proposalId];
    this.tryGrantAchievement(state, proposer, "ach_family_created", now);
    this.tryGrantAchievement(state, targetPlayer, "ach_family_created", now);
    state.stats.marriages += 1;

    return family;
  }

  rejectProposal(state: GameState, target: TelegramIdentity, proposalId: string, now: string): void {
    const targetPlayer = this.ensurePlayer(state, target, now);
    const proposal = state.marriageProposals[proposalId];

    if (!proposal || proposal.targetId !== targetPlayer.id) {
      throw new Error("Предложение не найдено");
    }

    delete state.marriageProposals[proposalId];
  }

  divorce(state: GameState, identity: TelegramIdentity, now: string): void {
    const player = this.ensurePlayer(state, identity, now);
    const family = this.getPlayerFamily(state, player);
    if (!family) {
      throw new Error("Вы не состоите в семье");
    }

    for (const partnerId of family.partnerIds) {
      const partner = state.players[String(partnerId)];
      if (partner) {
        partner.familyId = undefined;
        partner.updatedAt = now;
      }
    }

    state.logs.push({
      id: createId("log"),
      level: "info",
      message: "family:divorce",
      meta: { familyId: family.id, actorId: player.id, partnerIds: family.partnerIds },
      createdAt: now
    });
    delete state.families[family.id];
  }

  travel(state: GameState, identity: TelegramIdentity, locationId: string, now: string): { name: string; xp: number; love: number } {
    const player = this.ensurePlayer(state, identity, now);
    const family = this.getPlayerFamily(state, player);
    if (!family) {
      throw new Error("Путешествия доступны семье");
    }

    const location = travelLocations.find((candidate) => candidate.id === locationId);
    if (!location) {
      throw new Error("Локация не найдена");
    }

    this.assertRequirements(player, family, location.requirements);
    this.economy.debitPlayer(player, location.price, `travel:${location.id}`, state.ledger, now);
    family.love += location.love;
    family.xp += location.xp;
    family.travelIds = [...new Set([...family.travelIds, location.id])];
    family.stats.travels += 1;
    family.stats.totalSpent += location.price;
    this.recalculateFamilyLevel(family, now);
    family.updatedAt = now;
    this.players.addXp(player, location.xp, now);
    this.tryGrantAchievement(state, player, "ach_first_travel", now);
    state.stats.travels += 1;

    return { name: location.name, xp: location.xp, love: location.love };
  }

  gift(state: GameState, identity: TelegramIdentity, itemId: string, now: string): CatalogItem {
    const player = this.ensurePlayer(state, identity, now);
    const family = this.getPlayerFamily(state, player);
    if (!family) {
      throw new Error("Подарки доступны после свадьбы");
    }

    const item = this.getCatalogItem(itemId);
    if (item.category !== "gift" && item.category !== "jewelry") {
      throw new Error("Этот предмет нельзя подарить через команду подарка");
    }

    this.economy.debitPlayer(player, item.price, `gift:${item.id}`, state.ledger, now);
    family.love += item.category === "jewelry" ? 18 : 5;
    family.stats.giftsSent += 1;
    family.stats.totalSpent += item.price;
    this.addInventoryItem(family.inventory, item.id, now);
    this.recalculateFamilyLevel(family, now);
    state.logs.push({
      id: createId("log"),
      level: "info",
      message: "family:gift",
      meta: { familyId: family.id, actorId: player.id, itemId: item.id },
      createdAt: now
    });

    return item;
  }

  sellItem(state: GameState, identity: TelegramIdentity, itemId: string, now: string): { item: CatalogItem; payout: number } {
    const player = this.ensurePlayer(state, identity, now);
    const item = this.getCatalogItem(itemId);
    const entry = player.inventory.find((candidate) => candidate.itemId === itemId);
    if (!entry) {
      throw new Error("Предмета нет в инвентаре");
    }

    entry.quantity -= 1;
    if (entry.quantity <= 0) {
      player.inventory = player.inventory.filter((candidate) => candidate.itemId !== itemId);
      player.transportIds = player.transportIds.filter((id) => id !== itemId);
      player.homeIds = player.homeIds.filter((id) => id !== itemId);
      player.petIds = player.petIds.filter((id) => id !== itemId);
    }

    const payout = Math.floor(item.price * GAME_BALANCE.economy.resaleRate);
    this.economy.creditPlayer(player, payout, `sell:${item.id}`, state.ledger, now);
    return { item, payout };
  }

  getPlayerProfile(state: GameState, identity: TelegramIdentity, now: string): { player: PlayerProfile; family?: Family } {
    const player = this.ensurePlayer(state, identity, now);
    return { player, family: this.getPlayerFamily(state, player) };
  }

  getInventory(state: GameState, identity: TelegramIdentity, now: string): Array<{ item: CatalogItem; quantity: number }> {
    const player = this.ensurePlayer(state, identity, now);
    return player.inventory.map((entry) => ({ item: this.getCatalogItem(entry.itemId), quantity: entry.quantity }));
  }

  getFamily(state: GameState, identity: TelegramIdentity, now: string): Family {
    const player = this.ensurePlayer(state, identity, now);
    const family = this.getPlayerFamily(state, player);
    if (!family) {
      throw new Error("Семья не найдена");
    }

    return family;
  }

  getFamilyRating(state: GameState): Array<{ family: Family; score: number }> {
    return Object.values(state.families)
      .map((family) => ({
        family,
        score:
          family.love * 10 +
          family.level * 1_000 +
          family.capital +
          family.achievements.length * 5_000 +
          family.travelIds.length * 2_000 +
          this.getFamilyAssetValue(family)
      }))
      .sort((left, right) => right.score - left.score);
  }

  listCatalog(category?: string): CatalogItem[] {
    return category ? catalogItems.filter((item) => item.category === category) : catalogItems;
  }

  listJobs(): typeof jobs {
    return jobs;
  }

  private getCatalogItem(itemId: string): CatalogItem {
    const item = this.catalogById.get(itemId);
    if (!item) {
      throw new Error("Предмет не найден");
    }

    return item;
  }

  private assertRequirements(player: PlayerProfile, family: Family | undefined, requirements: Requirement[] = []): void {
    const failed = requirements.flatMap((requirement) => {
      if (requirement.level !== undefined && player.level < requirement.level) {
        return [`уровень ${requirement.level}`];
      }

      if (requirement.familyLevel !== undefined && (!family || family.level < requirement.familyLevel)) {
        return [`уровень семьи ${requirement.familyLevel}`];
      }

      if (requirement.balance !== undefined && player.balance < requirement.balance) {
        return [`баланс ${requirement.balance}`];
      }

      if (requirement.itemId && !player.inventory.some((entry) => entry.itemId === requirement.itemId)) {
        return [`предмет ${requirement.itemId}`];
      }

      if (
        requirement.itemCategory &&
        !player.inventory.some((entry) => this.catalogById.get(entry.itemId)?.category === requirement.itemCategory)
      ) {
        return [`категория ${requirement.itemCategory}`];
      }

      return [];
    });

    if (failed.length > 0) {
      throw new Error(`Не выполнены требования: ${failed.join(", ")}`);
    }
  }

  private assertActive(player: PlayerProfile): void {
    if (player.settings.blocked) {
      throw new Error("Игрок заблокирован");
    }
  }

  private getPlayerFamily(state: GameState, player: PlayerProfile): Family | undefined {
    return player.familyId ? state.families[player.familyId] : undefined;
  }

  private addInventoryItem(inventory: InventoryEntry[], itemId: string, now: string): void {
    const existing = inventory.find((entry) => entry.itemId === itemId);
    if (existing) {
      existing.quantity += 1;
      return;
    }

    inventory.push({ itemId, quantity: 1, acquiredAt: now });
  }

  private syncOwnershipIndexes(player: PlayerProfile, item: CatalogItem): void {
    if (
      item.category === "car" ||
      item.category === "bicycle" ||
      item.category === "scooter" ||
      item.category === "motorcycle" ||
      item.category === "airplane" ||
      item.category === "helicopter" ||
      item.category === "yacht"
    ) {
      player.transportIds = [...new Set([...player.transportIds, item.id])];
    }

    if (item.category === "home") {
      player.homeIds = [...new Set([...player.homeIds, item.id])];
    }

    if (item.category === "pet") {
      player.petIds = [...new Set([...player.petIds, item.id])];
    }
  }

  private tryGrantAchievement(state: GameState, player: PlayerProfile, achievementId: string, now: string): void {
    const achievement = achievements.find((candidate) => candidate.id === achievementId);
    if (!achievement || player.achievements.includes(achievementId)) {
      return;
    }

    player.achievements.push(achievement.id);
    this.economy.creditPlayer(player, achievement.reward, `achievement:${achievement.id}`, state.ledger, now);
    this.players.addXp(player, achievement.xp, now);
  }

  private getFamilyAssetValue(family: Family): number {
    return family.inventory.reduce((sum, entry) => {
      const item = this.catalogById.get(entry.itemId);
      return sum + (item?.assetValue ?? 0) * entry.quantity;
    }, 0);
  }

  private recalculateFamilyLevel(family: Family, now: string): void {
    while (family.xp >= family.level * 250) {
      family.xp -= family.level * 250;
      family.level += 1;
    }

    family.title = this.familyTitle(family.level);
    family.updatedAt = now;
  }

  private familyTitle(level: number): string {
    if (level >= 50) {
      return "Легендарная династия";
    }

    if (level >= 25) {
      return "Великая семья";
    }

    if (level >= 10) {
      return "Крепкий союз";
    }

    if (level >= 3) {
      return "Развивающаяся семья";
    }

    return "Новая семья";
  }
}
