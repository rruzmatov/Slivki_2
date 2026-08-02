import type { Achievement, CatalogItem, FuelType, Job, LicenseType, TransportKind, TravelLocation } from "../domain/types";

type TransportSeed = {
  id: string;
  category: CatalogItem["category"];
  kind: TransportKind;
  brand: string;
  model: string;
  price: number;
  level: number;
  country: string;
  year: number;
  horsepower: number;
  topSpeedKmh: number;
  fuelType: FuelType;
  maintenanceCost: number;
  insuranceCost: number;
  canWork: boolean;
  unlockedJobs: string[];
  requiredLicense: LicenseType;
  upgradeSupport: boolean;
  rarity?: CatalogItem["rarity"];
  weightKg?: number;
  description?: string;
  passengerCapacity?: number;
  rangeKm?: number;
  dockRequirement?: string;
  airportRequirement?: string;
  businessUsage?: string[];
};

const resalePrice = (price: number): number => Math.floor(price * 0.6);
const repairCost = (price: number): number => Math.max(0, Math.floor(price * 0.08));

const transportItem = (seed: TransportSeed): CatalogItem => ({
  id: seed.id,
  category: seed.category,
  name: `${seed.brand} ${seed.model}`,
  price: seed.price,
  level: seed.level,
  rarity: seed.rarity ?? "common",
  transportKind: seed.kind,
  assetValue: resalePrice(seed.price),
  transport: {
    brand: seed.brand,
    model: seed.model,
    country: seed.country,
    year: seed.year,
    horsepower: seed.horsepower,
    topSpeedKmh: seed.topSpeedKmh,
    fuelType: seed.fuelType,
    maintenanceCost: seed.maintenanceCost,
    insuranceCost: seed.insuranceCost,
    canWork: seed.canWork,
    unlockedJobs: seed.unlockedJobs,
    resalePrice: resalePrice(seed.price),
    repairCost: repairCost(seed.price),
    requiredLicense: seed.requiredLicense,
    upgradeSupport: seed.upgradeSupport,
    weightKg: seed.weightKg,
    description: seed.description,
    defaultCondition: "new",
    canSell: true,
    canRepair: true,
    passengerCapacity: seed.passengerCapacity,
    rangeKm: seed.rangeKm,
    dockRequirement: seed.dockRequirement,
    airportRequirement: seed.airportRequirement,
    businessUsage: seed.businessUsage
  }
});

const bicycleCatalog: TransportSeed[] = [
  ["bike_giant_escape_3", "Giant", "Escape 3", 25_000, 1, "Taiwan", 2025, 12.3, 32, "Надежный городской велосипед для первых курьерских заказов."],
  ["bike_trek_fx_1", "Trek", "FX 1", 32_000, 1, "United States", 2025, 12.0, 34, "Легкий фитнес-велосипед с хорошим разгоном на ровных дорогах."],
  ["bike_merida_crossway_20", "Merida", "Crossway 20", 38_000, 2, "Taiwan", 2025, 13.4, 35, "Гибридная модель для города и плохого асфальта."],
  ["bike_scott_sub_cross_40", "Scott", "Sub Cross 40", 45_000, 2, "Switzerland", 2024, 13.7, 36, "Универсальный велосипед для длинных смен и стабильной скорости."],
  ["bike_cube_nature", "Cube", "Nature", 54_000, 3, "Germany", 2025, 13.8, 37, "Прочная рама и комфортная посадка для ежедневной доставки."],
  ["bike_cannondale_quick_5", "Cannondale", "Quick 5", 63_000, 3, "United States", 2024, 11.9, 38, "Быстрый городской велосипед с легкой рамой."],
  ["bike_specialized_sirrus_20", "Specialized", "Sirrus 2.0", 72_000, 4, "United States", 2025, 11.6, 39, "Скоростная модель для игроков, которые часто работают курьером."],
  ["bike_bmc_alpenchallenge", "BMC", "Alpenchallenge", 95_000, 5, "Switzerland", 2024, 10.8, 42, "Премиальный городской велосипед с высокой текущей стоимостью."],
  ["bike_forward_arsenal", "Forward", "Arsenal", 18_000, 1, "Russia", 2024, 14.8, 28, "Доступная стартовая модель с дешевым обслуживанием."],
  ["bike_stels_navigator_350", "Stels", "Navigator 350", 20_000, 1, "Russia", 2024, 15.2, 27, "Недорогой велосипед для первого шага в доставку."]
].map(([id, brand, model, price, level, country, year, weightKg, topSpeedKmh, description]) => ({
  id: String(id),
  category: "bicycle",
  kind: "bicycle",
  brand: String(brand),
  model: String(model),
  price: Number(price),
  level: Number(level),
  country: String(country),
  year: Number(year),
  horsepower: 0,
  topSpeedKmh: Number(topSpeedKmh),
  fuelType: "human",
  maintenanceCost: Math.floor(Number(price) * 0.015),
  insuranceCost: 0,
  canWork: true,
  unlockedJobs: ["job_courier", "job_food_delivery", "job_mail_delivery"],
  requiredLicense: "bicycle",
  upgradeSupport: true,
  rarity: Number(price) >= 70_000 ? "epic" : Number(price) >= 40_000 ? "rare" : "common",
  weightKg: Number(weightKg),
  description: String(description)
}));

const carCatalog: TransportSeed[] = [
  ...[
    ["BMW", "M3"], ["BMW", "M4"], ["BMW", "M5"], ["BMW", "M8"], ["BMW", "X3"], ["BMW", "X5"],
    ["BMW", "X6"], ["BMW", "X7"], ["BMW", "XM"], ["BMW", "i7"],
    ["Mercedes-Benz", "A-Class"], ["Mercedes-Benz", "C-Class"], ["Mercedes-Benz", "E-Class"], ["Mercedes-Benz", "S-Class"],
    ["Mercedes-Benz", "CLA"], ["Mercedes-Benz", "GLE"], ["Mercedes-Benz", "GLS"], ["Mercedes-Benz", "G-Class"],
    ["Mercedes-Benz", "AMG GT"], ["Mercedes-Benz", "Maybach"],
    ["Chevrolet", "Spark"], ["Chevrolet", "Nexia"], ["Chevrolet", "Cobalt"], ["Chevrolet", "Gentra"],
    ["Chevrolet", "Tracker"], ["Chevrolet", "Malibu"], ["Chevrolet", "Traverse"], ["Chevrolet", "Tahoe"],
    ["Chevrolet", "Captiva"], ["Chevrolet", "Equinox"],
    ["Toyota", "Corolla"], ["Toyota", "Camry"], ["Toyota", "Prius"], ["Toyota", "RAV4"], ["Toyota", "Hilux"],
    ["Toyota", "Land Cruiser"], ["Toyota", "Supra"], ["Toyota", "GR86"], ["Toyota", "Crown"], ["Toyota", "Alphard"],
    ["BYD", "Seagull"], ["BYD", "Dolphin"], ["BYD", "Seal"], ["BYD", "Han"], ["BYD", "Tang"], ["BYD", "Song Plus"], ["BYD", "Atto 3"],
    ["Tesla", "Model 3"], ["Tesla", "Model Y"], ["Tesla", "Model S"], ["Tesla", "Model X"], ["Tesla", "Cybertruck"], ["Tesla", "Roadster"]
  ].map(([brand, model], index): TransportSeed => {
    const electric = brand === "Tesla" || brand === "BYD";
    const premium = ["BMW", "Mercedes-Benz", "Tesla"].includes(brand);
    const chevroletProgression: Record<string, Partial<TransportSeed>> = {
      Spark: { price: 180_000, level: 5, unlockedJobs: [] },
      Nexia: { price: 260_000, level: 6, unlockedJobs: [] },
      Cobalt: { price: 450_000, level: 8, unlockedJobs: ["job_taxi"] },
      Gentra: { price: 620_000, level: 10, unlockedJobs: ["job_taxi"] }
    };
    const override = brand === "Chevrolet" ? chevroletProgression[model] : undefined;
    const price = override?.price ?? (premium ? 1_200_000 + index * 120_000 : 520_000 + index * 65_000);

    return {
      id: `car_${brand.toLowerCase().replaceAll("-", "").replaceAll(" ", "_")}_${model.toLowerCase().replaceAll(" ", "_")}`,
      category: "car",
      kind: "car",
      brand,
      model,
      price,
      level: override?.level ?? (premium ? 16 + Math.floor(index / 3) : 8 + Math.floor(index / 4)),
      country: brand === "BYD" ? "China" : brand === "Toyota" ? "Japan" : brand === "Chevrolet" ? "United States" : brand === "Tesla" ? "United States" : "Germany",
      year: 2024,
      horsepower: electric ? 210 + index * 8 : 110 + index * 12,
      topSpeedKmh: electric ? 180 + Math.min(index * 2, 90) : 160 + Math.min(index * 3, 120),
      fuelType: electric ? "electric" : model === "Prius" ? "hybrid" : "petrol",
      maintenanceCost: Math.floor(price * 0.01),
      insuranceCost: Math.floor(price * 0.006),
      canWork: (override?.unlockedJobs?.length ?? 0) > 0 || ["Camry", "Corolla", "Prius"].includes(model),
      unlockedJobs: override?.unlockedJobs ?? (["Camry", "Corolla", "Prius"].includes(model) ? ["job_taxi"] : []),
      requiredLicense: "car",
      upgradeSupport: true,
      rarity: price > 4_000_000 ? "legendary" : price > 1_500_000 ? "epic" : "rare",
      passengerCapacity: 4,
      rangeKm: electric ? 430 : 650,
      businessUsage: ["business_taxi_company", "business_car_dealer"]
    };
  })
];

const transportCatalog: CatalogItem[] = [
  ...bicycleCatalog.map(transportItem),
  transportItem({
    id: "motorcycle_city_150",
    category: "motorcycle",
    kind: "motorcycle",
    brand: "Honda",
    model: "City 150",
    price: 420_000,
    level: 5,
    country: "Japan",
    year: 2024,
    horsepower: 15,
    topSpeedKmh: 110,
    fuelType: "petrol",
    maintenanceCost: 12_000,
    insuranceCost: 8_000,
    canWork: true,
    unlockedJobs: ["job_express_courier", "job_medicine_delivery"],
    requiredLicense: "motorcycle",
    upgradeSupport: true
  }),
  ...carCatalog.map(transportItem),
  transportItem({
    id: "truck_logistics",
    category: "truck",
    kind: "truck",
    brand: "Mercedes-Benz",
    model: "Actros",
    price: 8_500_000,
    level: 18,
    country: "Germany",
    year: 2024,
    horsepower: 450,
    topSpeedKmh: 120,
    fuelType: "diesel",
    maintenanceCost: 180_000,
    insuranceCost: 95_000,
    canWork: true,
    unlockedJobs: ["job_long_distance_driver"],
    requiredLicense: "truck",
    upgradeSupport: true,
    businessUsage: ["business_logistics"]
  }),
  transportItem({
    id: "ship_cargo",
    category: "ship",
    kind: "ship",
    brand: "Hyundai Heavy",
    model: "Cargo 1200",
    price: 80_000_000,
    level: 38,
    country: "South Korea",
    year: 2022,
    horsepower: 12_000,
    topSpeedKmh: 42,
    fuelType: "marine_diesel",
    maintenanceCost: 2_500_000,
    insuranceCost: 1_200_000,
    canWork: true,
    unlockedJobs: ["job_captain"],
    requiredLicense: "captain",
    upgradeSupport: true,
    dockRequirement: "commercial_port",
    businessUsage: ["business_shipping_company"]
  }),
  transportItem({
    id: "yacht_luxury",
    category: "yacht",
    kind: "yacht",
    brand: "Azimut",
    model: "Grande",
    price: 45_000_000,
    level: 34,
    country: "Italy",
    year: 2025,
    horsepower: 2_400,
    topSpeedKmh: 55,
    fuelType: "marine_diesel",
    maintenanceCost: 1_600_000,
    insuranceCost: 700_000,
    canWork: false,
    unlockedJobs: [],
    requiredLicense: "captain",
    upgradeSupport: true,
    dockRequirement: "marina",
    businessUsage: ["business_hotel"]
  }),
  ...[
    ["Cessna", "172", 9_000_000, 26, 4, 1_200],
    ["Pilatus", "PC-12", 38_000_000, 34, 9, 3_400],
    ["Embraer", "E190", 220_000_000, 44, 114, 4_500],
    ["Boeing", "737", 780_000_000, 55, 189, 5_600],
    ["Boeing", "747", 2_400_000_000, 70, 416, 13_450],
    ["Boeing", "777", 2_800_000_000, 74, 396, 15_800],
    ["Boeing", "787", 3_100_000_000, 78, 296, 14_100],
    ["Airbus", "A320", 760_000_000, 54, 180, 6_100],
    ["Airbus", "A321", 920_000_000, 58, 220, 7_400],
    ["Airbus", "A330", 1_900_000_000, 66, 277, 13_400],
    ["Airbus", "A350", 2_900_000_000, 76, 350, 15_000],
    ["Airbus", "A380", 4_200_000_000, 85, 853, 15_200]
  ].map(([brand, model, price, level, capacity, range], index) => transportItem({
    id: `airplane_${String(brand).toLowerCase()}_${String(model).toLowerCase().replaceAll("-", "")}`,
    category: "airplane",
    kind: "airplane",
    brand: String(brand),
    model: String(model),
    price: Number(price),
    level: Number(level),
    country: brand === "Airbus" ? "France" : brand === "Pilatus" ? "Switzerland" : brand === "Embraer" ? "Brazil" : "United States",
    year: 2024,
    horsepower: 900 + index * 2_200,
    topSpeedKmh: 230 + index * 55,
    fuelType: "jet_fuel",
    maintenanceCost: Math.floor(Number(price) * 0.012),
    insuranceCost: Math.floor(Number(price) * 0.004),
    canWork: true,
    unlockedJobs: ["job_pilot"],
    requiredLicense: "pilot",
    upgradeSupport: true,
    passengerCapacity: Number(capacity),
    rangeKm: Number(range),
    airportRequirement: Number(capacity) > 100 ? "international_airport" : "regional_airport",
    businessUsage: ["business_airline"]
  })),
  transportItem({
    id: "helicopter_robinson_r44",
    category: "helicopter",
    kind: "helicopter",
    brand: "Robinson",
    model: "R44",
    price: 22_000_000,
    level: 30,
    country: "United States",
    year: 2024,
    horsepower: 245,
    topSpeedKmh: 240,
    fuelType: "petrol",
    maintenanceCost: 480_000,
    insuranceCost: 260_000,
    canWork: true,
    unlockedJobs: ["job_pilot"],
    requiredLicense: "pilot",
    upgradeSupport: true,
    passengerCapacity: 4,
    rangeKm: 560,
    airportRequirement: "helipad"
  })
];

export const catalogItems: CatalogItem[] = [
  { id: "home_apartment", category: "home", name: "Квартира", price: 3_500_000, level: 12, assetValue: 3_000_000, rarity: "rare", requirements: [{ itemId: "car_chevrolet_cobalt" }] },
  { id: "home_house", category: "home", name: "Дом", price: 12_000_000, level: 20, assetValue: 10_500_000, rarity: "epic" },
  { id: "home_penthouse", category: "home", name: "Пентхаус", price: 90_000_000, level: 45, assetValue: 78_000_000, rarity: "legendary" },
  { id: "business_cafe", category: "business", name: "Кафе", price: 18_000_000, level: 22, assetValue: 14_000_000, rarity: "rare", requirements: [{ itemId: "home_apartment" }], metadata: { income: 250_000, expenses: 90_000, employees: 3 } },
  { id: "business_taxi_company", category: "business", name: "Таксопарк", price: 55_000_000, level: 28, assetValue: 42_000_000, rarity: "epic", requirements: [{ itemId: "car_chevrolet_cobalt" }], metadata: { income: 900_000, expenses: 350_000, employees: 8 } },
  { id: "business_airline", category: "business", name: "Авиакомпания", price: 5_000_000_000, level: 80, assetValue: 3_800_000_000, rarity: "mythic", requirements: [{ itemCategory: "airplane" }], metadata: { income: 80_000_000, expenses: 46_000_000, employees: 120 } },
  { id: "gift_flowers", category: "gift", name: "Букет цветов", price: 250, level: 1, assetValue: 0, rarity: "common" },
  { id: "gift_ring", category: "jewelry", name: "Кольцо", price: 5_000, level: 3, assetValue: 3_500, rarity: "rare" },
  { id: "ticket_paris", category: "ticket", name: "Билет в Париж", price: 12_000, level: 10, assetValue: 0, rarity: "rare" },
  { id: "ticket_tokyo", category: "ticket", name: "Билет в Токио", price: 18_000, level: 18, assetValue: 0, rarity: "epic" },
  { id: "ticket_new_york", category: "ticket", name: "Билет в Нью-Йорк", price: 22_000, level: 22, assetValue: 0, rarity: "epic" },
  { id: "ticket_dubai", category: "ticket", name: "Билет в Дубай", price: 16_000, level: 16, assetValue: 0, rarity: "rare" },
  { id: "ticket_london", category: "ticket", name: "Билет в Лондон", price: 20_000, level: 20, assetValue: 0, rarity: "epic" },
  ...transportCatalog
];

export const jobs: Job[] = [
  { id: "job_cleaner", title: "Уборщик", minLevel: 1, energyCost: 8, payout: 6_000, xp: 10, cooldownSeconds: 60 * 12 },
  { id: "job_loader", title: "Грузчик", minLevel: 1, energyCost: 12, payout: 8_500, xp: 14, cooldownSeconds: 60 * 15 },
  { id: "job_kitchen_assistant", title: "Помощник на кухне", minLevel: 1, energyCost: 10, payout: 7_000, xp: 12, cooldownSeconds: 60 * 14 },
  { id: "job_newspaper_delivery", title: "Разносчик газет", minLevel: 1, energyCost: 9, payout: 7_500, xp: 12, cooldownSeconds: 60 * 12 },
  { id: "job_courier", title: "Курьер", minLevel: 2, energyCost: 14, payout: 18_000, xp: 20, cooldownSeconds: 60 * 18, requirements: [{ itemCategory: "bicycle" }] },
  { id: "job_food_delivery", title: "Доставка еды", minLevel: 2, energyCost: 15, payout: 20_000, xp: 22, cooldownSeconds: 60 * 20, requirements: [{ itemCategory: "bicycle" }] },
  { id: "job_mail_delivery", title: "Почтальон", minLevel: 3, energyCost: 14, payout: 22_000, xp: 24, cooldownSeconds: 60 * 22, requirements: [{ itemCategory: "bicycle" }] },
  { id: "job_express_courier", title: "Экспресс-курьер", minLevel: 5, energyCost: 20, payout: 55_000, xp: 42, cooldownSeconds: 60 * 35, requirements: [{ itemCategory: "motorcycle" }] },
  { id: "job_medicine_delivery", title: "Доставка лекарств", minLevel: 6, energyCost: 22, payout: 70_000, xp: 48, cooldownSeconds: 60 * 40, requirements: [{ itemCategory: "motorcycle" }] },
  { id: "job_taxi", title: "Таксист", minLevel: 8, energyCost: 25, payout: 130_000, xp: 70, cooldownSeconds: 60 * 50, requirements: [{ itemId: "car_chevrolet_cobalt" }] },
  { id: "job_long_distance_driver", title: "Дальнобойщик", minLevel: 18, energyCost: 36, payout: 650_000, xp: 150, cooldownSeconds: 60 * 120, requirements: [{ itemCategory: "truck" }] },
  { id: "job_pilot", title: "Пилот", minLevel: 45, energyCost: 48, payout: 4_500_000, xp: 300, cooldownSeconds: 60 * 180, requirements: [{ itemCategory: "airplane" }] },
  { id: "job_captain", title: "Капитан", minLevel: 38, energyCost: 44, payout: 3_800_000, xp: 280, cooldownSeconds: 60 * 170, requirements: [{ itemCategory: "ship" }] }
];

export const travelLocations: TravelLocation[] = [
  { id: "travel_uzbekistan_tashkent", name: "Ташкент", price: 2_000, xp: 8, love: 2, requirements: [] },
  { id: "travel_samarkand", name: "Самарканд", price: 25_000, xp: 30, love: 5, requirements: [{ itemCategory: "bicycle" }] },
  { id: "travel_bukhara", name: "Бухара", price: 80_000, xp: 55, love: 8, requirements: [{ itemCategory: "motorcycle" }] },
  { id: "travel_mountains", name: "Горы", price: 250_000, xp: 90, love: 12, requirements: [{ itemCategory: "car" }, { level: 8 }] },
  { id: "travel_paris", name: "Париж", price: 20_000_000, xp: 220, love: 35, requirements: [{ itemCategory: "airplane" }, { itemId: "ticket_paris" }, { level: 25 }] },
  { id: "travel_tokyo", name: "Токио", price: 32_000_000, xp: 340, love: 42, requirements: [{ itemCategory: "airplane" }, { itemId: "ticket_tokyo" }, { level: 30 }] },
  { id: "travel_new_york", name: "Нью-Йорк", price: 40_000_000, xp: 420, love: 50, requirements: [{ itemCategory: "airplane" }, { itemId: "ticket_new_york" }, { level: 35 }] },
  { id: "travel_dubai", name: "Дубай", price: 26_000_000, xp: 280, love: 38, requirements: [{ itemCategory: "airplane" }, { itemId: "ticket_dubai" }, { level: 28 }] },
  { id: "travel_london", name: "Лондон", price: 36_000_000, xp: 380, love: 46, requirements: [{ itemCategory: "airplane" }, { itemId: "ticket_london" }, { level: 33 }] },
  { id: "travel_cruise", name: "Круиз", price: 55_000_000, xp: 500, love: 70, requirements: [{ itemCategory: "yacht" }, { familyLevel: 10 }] }
];

export const achievements: Achievement[] = [
  { id: "ach_first_job", title: "Первая смена", description: "Выполнить первую работу", xp: 30, reward: 15_000 },
  { id: "ach_first_car", title: "Первый автомобиль", description: "Купить первую машину", xp: 80, reward: 75_000 },
  { id: "ach_family_created", title: "Новая семья", description: "Создать семью", xp: 120, reward: 100_000 },
  { id: "ach_first_travel", title: "Первое путешествие", description: "Открыть первую локацию", xp: 100, reward: 70_000 }
];
