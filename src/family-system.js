const fs = require("fs");
const path = require("path");

const FAMILY_LOVE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const FAMILY_LOVE_GAIN = 10;
const FAMILY_LOVE_XP_GAIN = 25;
const WORK_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const DEFAULT_FAMILY_LEVEL = 1;
const DEFAULT_FAMILY_BALANCE = 0;
const DEFAULT_FAMILY_LOVE = 0;
const DEFAULT_FAMILY_XP = 0;
const DEFAULT_PROFESSION = "unemployed";
const DEFAULT_CAREER_LEVEL = 1;
const DEFAULT_CAREER_XP = 0;

const PROFESSIONS = {
  unemployed: { name: "Безработный", requiredLevel: 1, requiresItem: null, payMin: 0, payMax: 0, xpPerWork: 0 },
  courier: { name: "Курьер", requiredLevel: 1, requiresItem: null, payMin: 50, payMax: 150, xpPerWork: 10 },
  barista: { name: "Бариста", requiredLevel: 3, requiresItem: null, payMin: 100, payMax: 250, xpPerWork: 15 },
  taxi: { name: "Таксист", requiredLevel: 5, requiresItem: "car", payMin: 200, payMax: 450, xpPerWork: 20 },
  police: { name: "Полицейский", requiredLevel: 7, requiresItem: null, payMin: 300, payMax: 600, xpPerWork: 25 },
  programmer: { name: "Программист", requiredLevel: 10, requiresItem: null, payMin: 500, payMax: 1000, xpPerWork: 35 },
  doctor: { name: "Врач", requiredLevel: 15, requiresItem: null, payMin: 800, payMax: 1500, xpPerWork: 45 },
  pilot: { name: "Пилот", requiredLevel: 20, requiresItem: "plane", payMin: 1500, payMax: 3000, xpPerWork: 60 }
};

const LEGACY_PROFESSION_NAMES = {
  "Без профессии": DEFAULT_PROFESSION,
  "Безработный": DEFAULT_PROFESSION
};

const REQUIRED_ITEM_NAMES = {
  car: "машина",
  plane: "самолёт"
};

const FAMILIES_FILE = path.join(__dirname, "families.json");
const CAREERS_FILE = path.join(__dirname, "careers.json");

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      writeJsonFile(filePath, fallback);
      return fallback;
    }

    const content = fs.readFileSync(filePath, "utf8").trim();
    if (!content) return fallback;

    const data = JSON.parse(content);
    return data && typeof data === "object" && !Array.isArray(data) ? data : fallback;
  } catch (error) {
    console.error(`Family system read error (${path.basename(filePath)}):`, error?.message || error);
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  try {
    const tmpFile = `${filePath}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpFile, filePath);
    return true;
  } catch (error) {
    console.error(`Family system write error (${path.basename(filePath)}):`, error?.message || error);
    return false;
  }
}

function getSortedPartnerIds(firstUserId, secondUserId) {
  return [Number(firstUserId), Number(secondUserId)].sort((a, b) => a - b);
}

function getMarriageId(chatId, firstUserId, secondUserId) {
  const [leftUserId, rightUserId] = getSortedPartnerIds(firstUserId, secondUserId);
  return `${chatId}:${leftUserId}:${rightUserId}`;
}

function getXpToNextLevel(level) {
  return Math.max(1, Number(level) || DEFAULT_FAMILY_LEVEL) * 100;
}

function getXpToNextCareerLevel(level) {
  return Math.max(1, Number(level) || DEFAULT_CAREER_LEVEL) * 80;
}

function normalizeFamily(family, marriageId, chatId, firstUserId, secondUserId) {
  const [leftUserId, rightUserId] = getSortedPartnerIds(firstUserId, secondUserId);

  return {
    marriageId,
    chatId: Number(chatId),
    user1Id: leftUserId,
    user2Id: rightUserId,
    level: Math.max(1, Number(family?.level) || DEFAULT_FAMILY_LEVEL),
    xp: Math.max(0, Number(family?.xp) || DEFAULT_FAMILY_XP),
    love: Math.max(0, Number(family?.love) || DEFAULT_FAMILY_LOVE),
    balance: Math.max(0, Number(family?.balance) || DEFAULT_FAMILY_BALANCE),
    createdAt: typeof family?.createdAt === "string" ? family.createdAt : new Date().toISOString(),
    achievements: Array.isArray(family?.achievements) ? family.achievements : [],
    lastLoveAt: typeof family?.lastLoveAt === "string" ? family.lastLoveAt : ""
  };
}

function normalizeProfessionKey(profession) {
  if (PROFESSIONS[profession]) return profession;
  if (LEGACY_PROFESSION_NAMES[profession]) return LEGACY_PROFESSION_NAMES[profession];

  const normalized = String(profession || "").trim().toLowerCase();
  return PROFESSIONS[normalized] ? normalized : DEFAULT_PROFESSION;
}

function normalizeCareer(career = {}) {
  return {
    profession: normalizeProfessionKey(career.profession),
    level: Math.max(1, Number(career.level) || DEFAULT_CAREER_LEVEL),
    xp: Math.max(0, Number(career.xp) || DEFAULT_CAREER_XP),
    lastWorkAt: typeof career.lastWorkAt === "string" ? career.lastWorkAt : null
  };
}

function loadFamilies() {
  return readJsonFile(FAMILIES_FILE, {});
}

function saveFamilies(families) {
  return writeJsonFile(FAMILIES_FILE, families);
}

function loadCareers() {
  return readJsonFile(CAREERS_FILE, {});
}

function saveCareers(careers) {
  return writeJsonFile(CAREERS_FILE, careers);
}

function createFamilyForMarriage(chatId, firstUserId, secondUserId) {
  const families = loadFamilies();
  const marriageId = getMarriageId(chatId, firstUserId, secondUserId);
  const family = normalizeFamily(families[marriageId], marriageId, chatId, firstUserId, secondUserId);

  families[marriageId] = family;
  saveFamilies(families);

  return family;
}

function getFamilyByMarriage(chatId, firstUserId, secondUserId) {
  const families = loadFamilies();
  const marriageId = getMarriageId(chatId, firstUserId, secondUserId);
  const family = families[marriageId];

  if (!family) return null;

  return normalizeFamily(family, marriageId, chatId, firstUserId, secondUserId);
}

function ensureFamilyForMarriage(chatId, firstUserId, secondUserId) {
  return getFamilyByMarriage(chatId, firstUserId, secondUserId) || createFamilyForMarriage(chatId, firstUserId, secondUserId);
}

function levelUpFamily(family) {
  let leveledUp = false;

  while (family.xp >= getXpToNextLevel(family.level)) {
    family.xp -= getXpToNextLevel(family.level);
    family.level += 1;
    leveledUp = true;
  }

  return leveledUp;
}

function addLove(chatId, firstUserId, secondUserId) {
  const families = loadFamilies();
  const marriageId = getMarriageId(chatId, firstUserId, secondUserId);
  const family = normalizeFamily(families[marriageId], marriageId, chatId, firstUserId, secondUserId);
  const now = Date.now();
  const lastLoveAt = family.lastLoveAt ? new Date(family.lastLoveAt).getTime() : 0;

  if (lastLoveAt && now - lastLoveAt < FAMILY_LOVE_COOLDOWN_MS) {
    return {
      ok: false,
      reason: "cooldown",
      family,
      remainingMs: FAMILY_LOVE_COOLDOWN_MS - (now - lastLoveAt)
    };
  }

  family.love += FAMILY_LOVE_GAIN;
  family.xp += FAMILY_LOVE_XP_GAIN;
  family.lastLoveAt = new Date(now).toISOString();
  const leveledUp = levelUpFamily(family);

  families[marriageId] = family;
  saveFamilies(families);

  return {
    ok: true,
    family,
    loveGain: FAMILY_LOVE_GAIN,
    xpGain: FAMILY_LOVE_XP_GAIN,
    leveledUp
  };
}

function getCareer(userId) {
  const careers = loadCareers();
  const userKey = String(userId);
  const career = normalizeCareer(careers[userKey]);

  if (!careers[userKey]) {
    careers[userKey] = career;
    saveCareers(careers);
  }

  return career;
}

function canWork(userId) {
  const career = getCareer(userId);
  const now = Date.now();
  const lastWorkAt = career.lastWorkAt ? new Date(career.lastWorkAt).getTime() : 0;

  if (lastWorkAt && now - lastWorkAt < WORK_COOLDOWN_MS) {
    return {
      allowed: false,
      remainingMs: WORK_COOLDOWN_MS - (now - lastWorkAt)
    };
  }

  return { allowed: true };
}

function getRandomAmount(min, max) {
  const safeMin = Math.max(0, Number(min) || 0);
  const safeMax = Math.max(safeMin, Number(max) || safeMin);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function levelUpCareer(career) {
  let leveledUp = false;

  while (career.xp >= getXpToNextCareerLevel(career.level)) {
    career.xp -= getXpToNextCareerLevel(career.level);
    career.level += 1;
    leveledUp = true;
  }

  return leveledUp;
}

function doWork(userId, context = {}) {
  const chatId = context.chatId;
  const partnerId = context.partnerId;

  if (!chatId || !partnerId) {
    return {
      ok: false,
      reason: "no_marriage",
      message: "нужен брак, чтобы работать"
      // TODO: В будущей экономике можно добавить личный кошелёк без брака.
    };
  }

  const careers = loadCareers();
  const userKey = String(userId);
  const career = normalizeCareer(careers[userKey]);
  const profession = PROFESSIONS[career.profession] || PROFESSIONS[DEFAULT_PROFESSION];

  if (career.profession === DEFAULT_PROFESSION) {
    careers[userKey] = career;
    saveCareers(careers);
    return {
      ok: false,
      reason: "unemployed",
      career
    };
  }

  const workStatus = canWork(userId);
  if (!workStatus.allowed) {
    return {
      ok: false,
      reason: "cooldown",
      remainingMs: workStatus.remainingMs,
      career
    };
  }

  if (profession.requiresItem) {
    // TODO Фаза 3: проверить имущество семьи в inventory.json по profession.requiresItem.
  }

  const families = loadFamilies();
  const marriageId = getMarriageId(chatId, userId, partnerId);
  const family = normalizeFamily(families[marriageId], marriageId, chatId, userId, partnerId);
  const earned = getRandomAmount(profession.payMin, profession.payMax);

  family.balance += earned;
  career.xp += profession.xpPerWork;
  career.lastWorkAt = new Date().toISOString();
  const leveledUp = levelUpCareer(career);

  families[marriageId] = family;
  careers[userKey] = career;
  saveFamilies(families);
  saveCareers(careers);

  return {
    ok: true,
    earned,
    xpGain: profession.xpPerWork,
    professionKey: career.profession,
    professionName: profession.name,
    career,
    family,
    leveledUp,
    xpToNextLevel: getXpToNextCareerLevel(career.level)
  };
}

function getProfessionName(professionKey) {
  return (PROFESSIONS[professionKey] || PROFESSIONS[DEFAULT_PROFESSION]).name;
}

function getRequiredItemName(itemKey) {
  return REQUIRED_ITEM_NAMES[itemKey] || itemKey || "";
}

function getAvailableProfessions(userId) {
  const career = getCareer(userId);

  return Object.entries(PROFESSIONS).map(([key, profession]) => {
    const levelUnlocked = career.level >= profession.requiredLevel;

    return {
      key,
      ...profession,
      unlocked: levelUnlocked,
      levelUnlocked,
      // TODO Фаза 3: добавить реальную проверку имущества семьи для requiresItem.
      itemUnlocked: true,
      current: key === career.profession
    };
  });
}

function findProfessionKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";

  if (PROFESSIONS[normalized]) return normalized;

  const found = Object.entries(PROFESSIONS).find(([, profession]) => {
    return profession.name.toLowerCase() === normalized;
  });

  return found ? found[0] : "";
}

function switchProfession(userId, professionKey) {
  const key = findProfessionKey(professionKey);

  if (!key || !PROFESSIONS[key]) {
    return {
      ok: false,
      reason: "unknown_profession"
    };
  }

  const careers = loadCareers();
  const userKey = String(userId);
  const career = normalizeCareer(careers[userKey]);
  const profession = PROFESSIONS[key];

  if (career.level < profession.requiredLevel) {
    return {
      ok: false,
      reason: "level_required",
      requiredLevel: profession.requiredLevel,
      career,
      professionKey: key,
      professionName: profession.name
    };
  }

  if (profession.requiresItem) {
    // TODO Фаза 3: проверить наличие нужного имущества семьи перед сменой профессии.
  }

  career.profession = key;
  careers[userKey] = career;
  saveCareers(careers);

  return {
    ok: true,
    career,
    professionKey: key,
    professionName: profession.name
  };
}

function formatRemainingTime(ms) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes} мин.`;
  if (minutes === 0) return `${hours} ч.`;
  return `${hours} ч. ${minutes} мин.`;
}

module.exports = {
  FAMILY_LOVE_COOLDOWN_MS,
  FAMILY_LOVE_GAIN,
  FAMILY_LOVE_XP_GAIN,
  WORK_COOLDOWN_MS,
  PROFESSIONS,
  getMarriageId,
  getXpToNextLevel,
  getXpToNextCareerLevel,
  createFamilyForMarriage,
  ensureFamilyForMarriage,
  addLove,
  getCareer,
  canWork,
  doWork,
  getAvailableProfessions,
  switchProfession,
  findProfessionKey,
  getProfessionName,
  getRequiredItemName,
  formatRemainingTime
};
