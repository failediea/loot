// Item IDs from Cairo contract
export const ItemId: Record<string, number> = {
  Pendant: 1, Necklace: 2, Amulet: 3,
  SilverRing: 4, BronzeRing: 5, PlatinumRing: 6, TitaniumRing: 7, GoldRing: 8,
  GhostWand: 9, GraveWand: 10, BoneWand: 11, Wand: 12,
  Grimoire: 13, Chronicle: 14, Tome: 15, Book: 16,
  DivineRobe: 17, SilkRobe: 18, LinenRobe: 19, Robe: 20, Shirt: 21,
  Crown: 22, DivineHood: 23, SilkHood: 24, LinenHood: 25, Hood: 26,
  BrightsilkSash: 27, SilkSash: 28, WoolSash: 29, LinenSash: 30, Sash: 31,
  DivineSlippers: 32, SilkSlippers: 33, WoolShoes: 34, LinenShoes: 35, Shoes: 36,
  DivineGloves: 37, SilkGloves: 38, WoolGloves: 39, LinenGloves: 40, Gloves: 41,
  Katana: 42, Falchion: 43, Scimitar: 44, LongSword: 45, ShortSword: 46,
  DemonHusk: 47, DragonskinArmor: 48, StuddedLeatherArmor: 49, HardLeatherArmor: 50, LeatherArmor: 51,
  DemonCrown: 52, DragonsCrown: 53, WarCap: 54, LeatherCap: 55, Cap: 56,
  DemonhideBelt: 57, DragonskinBelt: 58, StuddedLeatherBelt: 59, HardLeatherBelt: 60, LeatherBelt: 61,
  DemonhideBoots: 62, DragonskinBoots: 63, StuddedLeatherBoots: 64, HardLeatherBoots: 65, LeatherBoots: 66,
  DemonsHands: 67, DragonskinGloves: 68, StuddedLeatherGloves: 69, HardLeatherGloves: 70, LeatherGloves: 71,
  Warhammer: 72, Quarterstaff: 73, Maul: 74, Mace: 75, Club: 76,
  HolyChestplate: 77, OrnateChestplate: 78, PlateMail: 79, ChainMail: 80, RingMail: 81,
  AncientHelm: 82, OrnateHelm: 83, GreatHelm: 84, FullHelm: 85, Helm: 86,
  OrnateBelt: 87, WarBelt: 88, PlatedBelt: 89, MeshBelt: 90, HeavyBelt: 91,
  HolyGreaves: 92, OrnateGreaves: 93, Greaves: 94, ChainBoots: 95, HeavyBoots: 96,
  HolyGauntlets: 97, OrnateGauntlets: 98, Gauntlets: 99, ChainGloves: 100, HeavyGloves: 101,
};

// Reverse mapping: ID → name
export const ItemName: Record<number, string> = Object.entries(ItemId).reduce(
  (acc, [name, id]) => {
    acc[id] = name.replace(/([A-Z])/g, " $1").trim();
    return acc;
  },
  {} as Record<number, string>
);

export const NUM_ITEMS = 101;
