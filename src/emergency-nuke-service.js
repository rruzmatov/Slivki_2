class EmergencyNukeService {
  constructor(options) {
    this.bot = options.bot;
    this.nukeService = options.nukeService;
    this.ownerIds = options.ownerIds;
    this.getBotIdentity = options.getBotIdentity;
    this.canBotUsePermission = options.canBotUsePermission;
    this.getChatTitle = options.getChatTitle;
    this.getErrorMessage = options.getErrorMessage;
    this.pendingChats = new Set();
  }

  isOwner(userId) {
    return this.ownerIds.includes(Number(userId));
  }

  getPendingKey(chatId, ownerId) {
    return `${chatId}:${ownerId}`;
  }

  async handleOwnerLeft(msg) {
    const leftUser = msg.left_chat_member;

    if (!leftUser || !this.isOwner(leftUser.id)) return;

    const key = this.getPendingKey(msg.chat.id, leftUser.id);

    if (this.pendingChats.has(key) || this.nukeService.isRunning(msg.chat.id)) {
      return;
    }

    const botIsReady = await this.canBotUsePermission(msg.chat.id, "can_restrict_members");

    if (!botIsReady) {
      return;
    }

    this.pendingChats.add(key);

    try {
      await this.bot.sendMessage(
        leftUser.id,
        this.nukeService.getEmergencyAlertText(this.getChatTitle(msg.chat.id)),
        this.nukeService.getEmergencyKeyboard(msg.chat.id)
      );
    } catch (error) {
      this.pendingChats.delete(key);
      console.error("Emergency alert send error:", this.getErrorMessage(error));
    }
  }

  async handleCallback(query) {
    const data = query.data || "";
    const parts = data.split(":");

    if (parts[0] !== "nuke") return false;

    const action = parts[1];
    const chatId = Number(parts[2]);

    if (!Number.isFinite(chatId)) return true;

    if (!this.isOwner(query.from?.id)) {
      return true;
    }

    const key = this.getPendingKey(chatId, query.from.id);

    if (action === "cancel") {
      this.pendingChats.delete(key);
      await this.bot.editMessageText("❌ Emergency NUKE отменён.", {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      }).catch((error) => {
        console.error("Emergency cancel edit error:", this.getErrorMessage(error));
      });
      return true;
    }

    if (action === "emergency") {
      await this.bot.editMessageText(this.nukeService.getEmergencyConfirmText(), {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        ...this.nukeService.getEmergencyConfirmKeyboard(chatId)
      }).catch((error) => {
        console.error("Emergency confirm edit error:", this.getErrorMessage(error));
      });
      return true;
    }

    if (action === "confirm") {
      if (!this.pendingChats.has(key)) {
        await this.bot.sendMessage(query.message.chat.id, "⚠️ Emergency NUKE уже неактуален или был отменён.");
        return true;
      }

      this.pendingChats.delete(key);
      await this.nukeService.startEmergencyNuke(query, chatId);
      return true;
    }

    return true;
  }
}

module.exports = EmergencyNukeService;
