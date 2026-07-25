import type { Achievement, CatalogItem, Job, TravelLocation } from "../domain/types";

const uzbekCars = [
  "Cobalt", "Damas", "Labo", "Spark", "Nexia", "Lacetti", "Gentra", "Malibu", "Tracker", "Onix",
  "Epica", "Captiva", "Equinox", "Tahoe", "Trailblazer", "Monza", "Orlando", "Matiz", "Tico", "Espero"
];

const globalCarBrands = [
  "BMW", "Mercedes", "Toyota", "Audi", "Ferrari", "Lamborghini", "Rolls Royce", "Bentley", "Bugatti", "Tesla",
  "McLaren", "Porsche", "Honda", "Nissan", "Kia", "Hyundai", "Lexus", "Mazda", "Volkswagen", "Volvo",
  "Ford", "Chevrolet", "Jeep", "Cadillac", "Maserati", "Aston Martin", "Jaguar", "Land Rover", "Subaru", "Mitsubishi",
  "Peugeot", "Renault", "Citroen", "Skoda", "Seat", "Mini", "Genesis", "Infiniti", "Acura", "Alfa Romeo"
];

const carModelSuffixes = ["City", "Touring", "Sport", "Elite", "Luxury", "GT", "Hybrid", "Executive", "Velocity", "Signature"];

const carItems: CatalogItem[] = [
  ...uzbekCars.map((name, index): CatalogItem => ({
    id: `car_uz_${name.toLowerCase().replaceAll(" ", "_")}`,
    category: "car",
    name,
    price: 8_000 + index * 4_500,
    level: Math.max(5, 5 + Math.floor(index / 2)),
    transportKind: "car",
    assetValue: 7_000 + index * 4_000,
    rarity: index > 15 ? "rare" : "common",
    metadata: { market: "uzbekistan" }
  })),
  ...globalCarBrands.flatMap((brand, brandIndex) =>
    carModelSuffixes.map((suffix, suffixIndex): CatalogItem => {
      const tier = brandIndex * carModelSuffixes.length + suffixIndex;
      const premium = ["Ferrari", "Lamborghini", "Rolls Royce", "Bentley", "Bugatti", "McLaren", "Porsche"].includes(brand);

      return {
        id: `car_${brand.toLowerCase().replaceAll(" ", "_")}_${suffix.toLowerCase()}`,
        category: "car",
        name: `${brand} ${suffix}`,
        price: premium ? 180_000 + tier * 3_500 : 24_000 + tier * 1_750,
        level: premium ? 35 + Math.floor(suffixIndex / 2) : 8 + Math.floor(tier / 14),
        transportKind: "car",
        assetValue: premium ? 150_000 + tier * 3_000 : 18_000 + tier * 1_400,
        rarity: premium ? "legendary" : tier > 220 ? "epic" : tier > 100 ? "rare" : "common",
        metadata: { brand, series: suffix }
      };
    })
  )
];

export const catalogItems: CatalogItem[] = [
  { id: "home_tent", category: "home", name: "Палатка", price: 2_000, level: 1, assetValue: 1_400, rarity: "common" },
  { id: "home_hut", category: "home", name: "Хижина", price: 7_000, level: 2, assetValue: 5_500, rarity: "common" },
  { id: "home_small_house", category: "home", name: "Маленький дом", price: 25_000, level: 5, assetValue: 22_000, rarity: "common" },
  { id: "home_house", category: "home", name: "Дом", price: 60_000, level: 8, assetValue: 52_000, rarity: "rare" },
  { id: "home_cottage", category: "home", name: "Коттедж", price: 130_000, level: 15, assetValue: 112_000, rarity: "rare" },
  { id: "home_townhouse", category: "home", name: "Таунхаус", price: 240_000, level: 22, assetValue: 205_000, rarity: "epic" },
  { id: "home_mansion", category: "home", name: "Особняк", price: 600_000, level: 35, assetValue: 520_000, rarity: "epic" },
  { id: "home_villa", category: "home", name: "Вилла", price: 1_200_000, level: 45, assetValue: 1_050_000, rarity: "legendary" },
  { id: "home_castle", category: "home", name: "Замок", price: 3_000_000, level: 60, assetValue: 2_650_000, rarity: "legendary" },
  { id: "home_penthouse", category: "home", name: "Пентхаус", price: 5_000_000, level: 70, assetValue: 4_500_000, rarity: "mythic" },
  { id: "home_private_island", category: "home", name: "Частный остров", price: 15_000_000, level: 85, assetValue: 13_000_000, rarity: "mythic" },
  { id: "bike_city", category: "bicycle", name: "Городской велосипед", price: 900, level: 1, transportKind: "bicycle", assetValue: 500, rarity: "common" },
  { id: "bike_mountain", category: "bicycle", name: "Горный велосипед", price: 2_500, level: 3, transportKind: "bicycle", assetValue: 1_700, rarity: "rare" },
  { id: "scooter_city", category: "scooter", name: "Городской самокат", price: 1_400, level: 2, transportKind: "scooter", assetValue: 900, rarity: "common" },
  { id: "scooter_electric", category: "scooter", name: "Электросамокат", price: 4_200, level: 4, transportKind: "scooter", assetValue: 3_200, rarity: "rare" },
  { id: "moto_scooter", category: "motorcycle", name: "Скутер", price: 6_000, level: 4, transportKind: "motorcycle", assetValue: 4_000, rarity: "common" },
  { id: "moto_sport", category: "motorcycle", name: "Спортбайк", price: 28_000, level: 12, transportKind: "motorcycle", assetValue: 21_000, rarity: "epic" },
  { id: "airplane_light", category: "airplane", name: "Легкий самолет", price: 900_000, level: 40, transportKind: "airplane", assetValue: 760_000, rarity: "legendary" },
  { id: "airplane_private_jet", category: "airplane", name: "Частный самолет", price: 8_000_000, level: 70, transportKind: "airplane", assetValue: 6_800_000, rarity: "mythic" },
  { id: "helicopter_city", category: "helicopter", name: "Городской вертолет", price: 1_700_000, level: 50, transportKind: "helicopter", assetValue: 1_450_000, rarity: "legendary" },
  { id: "yacht_compact", category: "yacht", name: "Компактная яхта", price: 750_000, level: 35, transportKind: "yacht", assetValue: 600_000, rarity: "epic" },
  { id: "yacht_ocean", category: "yacht", name: "Океанская яхта", price: 5_500_000, level: 65, transportKind: "yacht", assetValue: 4_700_000, rarity: "mythic" },
  { id: "pet_dog_shiba", category: "pet", name: "Сиба-ину", price: 5_000, level: 2, assetValue: 3_000, rarity: "rare" },
  { id: "pet_dog_labrador", category: "pet", name: "Лабрадор", price: 6_500, level: 4, assetValue: 4_200, rarity: "rare" },
  { id: "pet_dog_husky", category: "pet", name: "Хаски", price: 9_000, level: 6, assetValue: 6_500, rarity: "epic" },
  { id: "pet_cat_british", category: "pet", name: "Британская кошка", price: 4_000, level: 2, assetValue: 2_600, rarity: "rare" },
  { id: "pet_cat_maine_coon", category: "pet", name: "Мейн-кун", price: 11_000, level: 7, assetValue: 7_500, rarity: "epic" },
  { id: "pet_parrot_ara", category: "pet", name: "Попугай ара", price: 12_000, level: 8, assetValue: 8_500, rarity: "epic" },
  { id: "pet_fox", category: "pet", name: "Фенек", price: 45_000, level: 20, assetValue: 32_000, rarity: "legendary" },
  { id: "pet_tiger", category: "pet", name: "Белый тигр", price: 250_000, level: 45, assetValue: 180_000, rarity: "mythic" },
  { id: "gift_flowers", category: "gift", name: "Букет цветов", price: 250, level: 1, assetValue: 0, rarity: "common" },
  { id: "gift_ring", category: "jewelry", name: "Кольцо", price: 5_000, level: 3, assetValue: 3_500, rarity: "rare" },
  { id: "ticket_paris", category: "ticket", name: "Билет в Париж", price: 12_000, level: 10, assetValue: 0, rarity: "rare" },
  { id: "ticket_tokyo", category: "ticket", name: "Билет в Токио", price: 18_000, level: 18, assetValue: 0, rarity: "epic" },
  { id: "ticket_new_york", category: "ticket", name: "Билет в Нью-Йорк", price: 22_000, level: 22, assetValue: 0, rarity: "epic" },
  { id: "ticket_dubai", category: "ticket", name: "Билет в Дубай", price: 16_000, level: 16, assetValue: 0, rarity: "rare" },
  { id: "ticket_london", category: "ticket", name: "Билет в Лондон", price: 20_000, level: 20, assetValue: 0, rarity: "epic" },
  ...carItems
];

export const jobs: Job[] = [
  { id: "job_courier", title: "Курьер", minLevel: 1, energyCost: 12, payout: 170, xp: 16, cooldownSeconds: 60 * 18 },
  { id: "job_barista", title: "Бариста", minLevel: 3, energyCost: 15, payout: 280, xp: 28, cooldownSeconds: 60 * 25 },
  { id: "job_taxi", title: "Таксист", minLevel: 7, energyCost: 22, payout: 650, xp: 55, cooldownSeconds: 60 * 40, requirements: [{ itemCategory: "car" }] },
  { id: "job_police", title: "Полицейский", minLevel: 12, energyCost: 26, payout: 900, xp: 75, cooldownSeconds: 60 * 50 },
  { id: "job_programmer", title: "Программист", minLevel: 20, energyCost: 30, payout: 1_800, xp: 110, cooldownSeconds: 60 * 65 },
  { id: "job_doctor", title: "Врач", minLevel: 32, energyCost: 38, payout: 3_800, xp: 180, cooldownSeconds: 60 * 95 },
  { id: "job_pilot", title: "Пилот", minLevel: 45, energyCost: 48, payout: 7_500, xp: 300, cooldownSeconds: 60 * 150, requirements: [{ itemCategory: "airplane" }] },
  { id: "job_director", title: "Директор", minLevel: 70, energyCost: 60, payout: 18_000, xp: 650, cooldownSeconds: 60 * 260 }
];

export const travelLocations: TravelLocation[] = [
  { id: "travel_park", name: "Парк", price: 80, xp: 8, love: 2, requirements: [] },
  { id: "travel_cafe", name: "Кафе", price: 220, xp: 12, love: 4, requirements: [] },
  { id: "travel_cinema", name: "Кино", price: 450, xp: 18, love: 6, requirements: [] },
  { id: "travel_forest", name: "Лес", price: 500, xp: 24, love: 5, requirements: [{ itemCategory: "bicycle" }] },
  { id: "travel_lake", name: "Озеро", price: 700, xp: 30, love: 6, requirements: [{ itemCategory: "bicycle" }] },
  { id: "travel_mountains", name: "Горы", price: 2_500, xp: 65, love: 12, requirements: [{ itemCategory: "car" }, { level: 8 }] },
  { id: "travel_sea", name: "Море", price: 4_500, xp: 90, love: 16, requirements: [{ itemCategory: "car" }, { level: 12 }] },
  { id: "travel_paris", name: "Париж", price: 20_000, xp: 220, love: 35, requirements: [{ itemCategory: "airplane" }, { itemId: "ticket_paris" }, { level: 25 }] },
  { id: "travel_tokyo", name: "Токио", price: 32_000, xp: 340, love: 42, requirements: [{ itemCategory: "airplane" }, { itemId: "ticket_tokyo" }, { level: 30 }] },
  { id: "travel_new_york", name: "Нью-Йорк", price: 40_000, xp: 420, love: 50, requirements: [{ itemCategory: "airplane" }, { itemId: "ticket_new_york" }, { level: 35 }] },
  { id: "travel_dubai", name: "Дубай", price: 26_000, xp: 280, love: 38, requirements: [{ itemCategory: "airplane" }, { itemId: "ticket_dubai" }, { level: 28 }] },
  { id: "travel_london", name: "Лондон", price: 36_000, xp: 380, love: 46, requirements: [{ itemCategory: "airplane" }, { itemId: "ticket_london" }, { level: 33 }] },
  { id: "travel_islands", name: "Острова", price: 35_000, xp: 340, love: 48, requirements: [{ itemCategory: "yacht" }, { level: 35 }] },
  { id: "travel_cruise", name: "Круиз", price: 55_000, xp: 500, love: 70, requirements: [{ itemCategory: "yacht" }, { familyLevel: 10 }] }
];

export const achievements: Achievement[] = [
  { id: "ach_first_job", title: "Первая смена", description: "Выполнить первую работу", xp: 30, reward: 150 },
  { id: "ach_first_car", title: "Первый автомобиль", description: "Купить первую машину", xp: 80, reward: 500 },
  { id: "ach_family_created", title: "Новая семья", description: "Создать семью", xp: 120, reward: 1_000 },
  { id: "ach_first_travel", title: "Первое путешествие", description: "Открыть первую локацию", xp: 100, reward: 700 }
];
