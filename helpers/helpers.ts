import request from "request";
import {
  ResponseAuthData,
  TCdekUser,
  TDeliveryRequest,
  TDeliveryResponse,
  TProduct,
} from "../types/types";
import axios from "axios";

export const getOrderTrackNumber = async (
  uuid: string,
  token: string,
): Promise<{ entity: { uuid: string; cdek_number: string } }> => {
  try {
    const response = await axios.post(
      `${process.env.SERVER_API_URL}/orders/info/`,
      { im_number: uuid, token: token },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    const data = response.data;

    return data;
  } catch (error: any) {
    throw new Error("Ошибка при запросе к CDEK API: " + error.message);
  }
};

// S размер - 4 обычные банки (если нет bigProds)
// M размер - до 20 обычных банок
// M размер - протеин и до 8 обычных банок
// M размер - гейнер и до 6 обычных банок
// L размер - до 45 обычных банок
// L размер - 3 протеина и до 8 банок
// L размер - 2 гейнера и до 7 банок
// XL размер - До 90 обычных банок
// XL размер - до 10 гейнеров До 30 обычных банок
// XL размер - до 14 протеинов До 30 обычных банок

const AVERAGE_ITEM_WEIGHT = 200; // грамм
const PROTEIN_WEIGHT = 1100; // грамм
const GAINER_WEIGHT = 3100; // грамм
const WEIGHT_GROSS_MARGIN = 100;

const SIZE_CONFIG = {
  XS_SIZE: { length: 17, width: 12, height: 10, name: "XS" }, // ~0.5 кг — 1 обычная банка
  S_SIZE: { length: 23, width: 19, height: 10, name: "S" }, // ~2 кг   — 2–4 обычных
  M_SIZE: { length: 33, width: 25, height: 15, name: "M" }, // ~5 кг — 5–20
  L_SIZE: { length: 31, width: 25, height: 38, name: "L" }, // ~12 кг — 21–40
  LP_SIZE: { length: 40, width: 30, height: 38, name: "L+" }, // ~15 кг  (Л+) — 41–55
  LPP_SIZE: { length: 50, width: 35, height: 38, name: "L++" }, // ~18 кг  (Л++) — 56–70
  XL_SIZE: { length: 60, width: 35, height: 30, name: "XL" }, // 18+ кг — 70+
} as const;

const getSizeKey = (
  proteinCount: number,
  gainerCount: number,
  regularCount: number,
  totalWeight: number,
): keyof typeof SIZE_CONFIG => {
  // Жёсткий предел по весу — любой заказ > 18 кг → XL
  if (totalWeight > 18_000) return "XL_SIZE";
  // ── XS — 1 обычная банка ─────────────────────────────────────────────────
  if (regularCount === 1 && proteinCount === 0 && gainerCount === 0)
    return "XS_SIZE";

  // ── S — 2–4 обычных ──────────────────────────────────────────────────────
  if (
    regularCount >= 2 &&
    regularCount <= 4 &&
    proteinCount === 0 &&
    gainerCount === 0
  )
    return "S_SIZE";

  // ── M ────────────────────────────────────────────────────────────────────
  if (
    // 5–20 обычных
    (regularCount >= 5 &&
      regularCount <= 20 &&
      proteinCount === 0 &&
      gainerCount === 0) ||
    // 1 протеин + до 8 обычных
    (proteinCount === 1 && gainerCount === 0 && regularCount <= 8) ||
    // 2 протеина + до 3 обычных
    (proteinCount === 2 && gainerCount === 0 && regularCount <= 3) ||
    // 1 гейнер + до 2 обычных
    (gainerCount === 1 && proteinCount === 0 && regularCount <= 2)
  )
    return "M_SIZE";

  // ── Л ────────────────────────────────────────────────────────────────────
  if (
    // 21–40 обычных
    (regularCount >= 21 &&
      regularCount <= 40 &&
      proteinCount === 0 &&
      gainerCount === 0) ||
    // 2 протеина + до 10 обычных (0–3 уже в M)
    (proteinCount === 2 && gainerCount === 0 && regularCount <= 10) ||
    // 3 протеина + до 5 обычных
    (proteinCount === 3 && gainerCount === 0 && regularCount <= 5) ||
    // 1 гейнер + до 15 обычных (0–2 уже в M)
    (gainerCount === 1 && proteinCount === 0 && regularCount <= 15) ||
    // 2 гейнера + до 7 обычных
    (gainerCount === 2 && proteinCount === 0 && regularCount <= 7) ||
    // 1 гейнер + 1 протеин + до 10 обычных
    (gainerCount === 1 && proteinCount === 1 && regularCount <= 10)
  )
    return "L_SIZE";

  // ── Л+ (40×30×38) ────────────────────────────────────────────────────────
  if (
    // 41–55 обычных
    (regularCount >= 41 &&
      regularCount <= 55 &&
      proteinCount === 0 &&
      gainerCount === 0) ||
    // 3 протеина + 6–10 обычных (≤5 уже в Л)
    (proteinCount === 3 && gainerCount === 0 && regularCount <= 10) ||
    // 4 протеина без обычных
    (proteinCount === 4 && gainerCount === 0 && regularCount === 0) ||
    // 1 гейнер + 16–20 обычных (≤15 уже в Л)
    (gainerCount === 1 && proteinCount === 0 && regularCount <= 20) ||
    // 2 гейнера + 8–12 обычных (≤7 уже в Л)
    (gainerCount === 2 && proteinCount === 0 && regularCount <= 12)
  )
    return "LP_SIZE";

  // ── Л++ (50×35×38) ───────────────────────────────────────────────────────
  if (
    // 56–70 обычных
    (regularCount >= 56 &&
      regularCount <= 70 &&
      proteinCount === 0 &&
      gainerCount === 0) ||
    // 4 протеина + 1–4 обычных (0 уже в Л+)
    (proteinCount === 4 && gainerCount === 0 && regularCount <= 4) ||
    // 5 протеинов
    (proteinCount === 5 && gainerCount === 0 && regularCount === 0) ||
    // 2 гейнера + 13–16 обычных (≤12 уже в Л+)
    (gainerCount === 2 && proteinCount === 0 && regularCount <= 16)
  )
    return "LPP_SIZE";

  // ── XL — всё остальное: 3+ гейнера, 6+ протеинов, 70+ обычных и т.д. ────
  return "XL_SIZE";
};

const createPackages = (
  proteinCount: number,
  gainerCount: number,
  regularCount: number,
  totalCount: number,
  totalPrice: number,
  hasPrepayment?: boolean,
) => {
  const totalWeight =
    proteinCount * PROTEIN_WEIGHT +
    gainerCount * GAINER_WEIGHT +
    regularCount * AVERAGE_ITEM_WEIGHT;

  const sizeKey = getSizeKey(
    proteinCount,
    gainerCount,
    regularCount,
    totalWeight,
  );
  const selectedSize = SIZE_CONFIG[sizeKey];

  const packages = [
    {
      number: "1",
      comment: `Упаковка 1 (${sizeKey}, всего ${totalCount} шт)`,
      height: selectedSize.height,
      length: selectedSize.length,
      width: selectedSize.width,
      weight: totalWeight,
      items: [
        {
          ware_key: "1",
          payment: {
            value: hasPrepayment ? 0 : 1,
          },
          name: "Биологически активные добавки Triple H",
          cost: totalCount > 0 ? Math.round(totalPrice / totalCount) : 0,
          amount: totalCount,
          weight: totalWeight,
        },
      ],
    },
  ];

  return packages;
};

export const getOrderObjRu = async (
  access_token: string | undefined,
  uuidCdek: string,
  totalPrice: any,
  surName: string,
  firstName: string,
  middleName: string,
  phone: string,
  selectedPvzCode: string,
  deliverySum: number,
  selectedTariff: number,
  address: string,
  cityCode: number,
  freeDelivery?: boolean,
  products?: TProduct[],
): Promise<TDeliveryRequest> => {
  // Считаем количество протеинов, гейнеров и обычных товаров
  const { proteinCount, gainerCount, regularCount, totalCount } =
    products?.reduce(
      (acc, product) => {
        const count = product.productCount;
        const nameLower = product.name?.toLowerCase() || "";
        const isProtein = nameLower.includes("протеин");
        const isGainer = nameLower.includes("гейнер");

        return {
          proteinCount: acc.proteinCount + (isProtein ? count : 0),
          gainerCount: acc.gainerCount + (isGainer ? count : 0),
          regularCount:
            acc.regularCount + (!isProtein && !isGainer ? count : 0),
          totalCount: acc.totalCount + count,
        };
      },
      { proteinCount: 0, gainerCount: 0, regularCount: 0, totalCount: 0 },
    ) ?? { proteinCount: 0, gainerCount: 0, regularCount: 0, totalCount: 0 };

  // Создаём packages
  const packages =
    totalCount > 0
      ? createPackages(
          proteinCount,
          gainerCount,
          regularCount,
          totalCount,
          totalPrice,
        )
      : [];

  const obj = {
    token: access_token,
    number: uuidCdek,
    type: 1,
    delivery_recipient_cost: {
      value: freeDelivery
        ? 0
        : packages.length > 0
          ? deliverySum -
            packages
              .flatMap((pkg) => pkg.items)
              .reduce((total, item) => total + item.amount, 0)
          : deliverySum - 1,
    },
    delivery_recipient_cost_adv: [
      {
        sum:
          packages.length > 0
            ? deliverySum -
              packages
                .flatMap((pkg) => pkg.items)
                .reduce((total, item) => total + item.amount, 0)
            : deliverySum - 1,
        threshold:
          packages.length > 0
            ? deliverySum -
              packages
                .flatMap((pkg) => pkg.items)
                .reduce((total, item) => total + item.amount, 0)
            : deliverySum - 1,
      },
    ],
    packages:
      packages.length > 0
        ? packages
        : [
            {
              number: "1",
              comment: "Упаковка по умолчанию",
              height: SIZE_CONFIG.S_SIZE.height,
              length: SIZE_CONFIG.S_SIZE.length,
              width: SIZE_CONFIG.S_SIZE.width,
              weight: 0,
              items: [
                {
                  ware_key: "1",
                  payment: {
                    value: 1,
                  },
                  name: "Биологически активные добавики Triple H",
                  cost: Number(totalPrice) / Number(totalCount),
                  amount: 1,
                  weight: 0,
                },
              ],
            },
          ],
    recipient: {
      name: `${surName} ${firstName} ${middleName}`,
      phones: [
        {
          number: phone,
        },
      ],
    },
    sender: {
      name: "Газиев Гаджи Хизриевич",
    },
    services: [
      {
        code: "INSURANCE",
        parameter: "0",
      },
    ],
    tariff_code: selectedTariff,
    shipment_point: process.env.SHIPMENT_POINT!,
  };

  if (address) {
    const courierDelivery: TDeliveryRequest = {
      ...obj,
      to_location: { code: cityCode, address: address },
    };

    return courierDelivery;
  } else {
    const warehouseDelivery: TDeliveryRequest = {
      ...obj,
      delivery_point: selectedPvzCode,
    };
    return warehouseDelivery;
  }
};

export const getOrderObjRuWithPrepayment = async (
  access_token: string | undefined,
  uuidCdek: string,
  totalPrice: any,
  surName: string,
  firstName: string,
  middleName: string,
  phone: string,
  selectedPvzCode: string,
  selectedTariff: number,
  address: string,
  cityCode: number,
  products?: TProduct[],
): Promise<TDeliveryRequest> => {
  const { proteinCount, gainerCount, regularCount, totalCount } =
    products?.reduce(
      (acc, product) => {
        const count = product.productCount;
        const nameLower = product.name?.toLowerCase() || "";
        const isProtein = nameLower.includes("протеин");
        const isGainer = nameLower.includes("гейнер");

        return {
          proteinCount: acc.proteinCount + (isProtein ? count : 0),
          gainerCount: acc.gainerCount + (isGainer ? count : 0),
          regularCount:
            acc.regularCount + (!isProtein && !isGainer ? count : 0),
          totalCount: acc.totalCount + count,
        };
      },
      { proteinCount: 0, gainerCount: 0, regularCount: 0, totalCount: 0 },
    ) ?? { proteinCount: 0, gainerCount: 0, regularCount: 0, totalCount: 0 };

  const packages =
    totalCount > 0
      ? createPackages(
          proteinCount,
          gainerCount,
          regularCount,
          totalCount,
          totalPrice,
          true,
        )
      : [];

  const obj = {
    token: access_token,
    number: uuidCdek,
    type: 1,
    delivery_recipient_cost: {
      value: 0,
    },
    packages:
      packages.length > 0
        ? packages
        : [
            {
              number: "1",
              comment: "Упаковка по умолчанию",
              height: SIZE_CONFIG.S_SIZE.height,
              length: SIZE_CONFIG.S_SIZE.length,
              width: SIZE_CONFIG.S_SIZE.width,
              weight: 0,
              items: [
                {
                  ware_key: "1",
                  payment: {
                    value: 0,
                  },
                  name: "Биологически активные добавики Triple H",
                  cost: Number(totalPrice) / Number(totalCount),
                  amount: 1,
                  weight: 0,
                },
              ],
            },
          ],
    recipient: {
      name: `${surName} ${firstName} ${middleName}`,
      phones: [
        {
          number: phone,
        },
      ],
    },
    sender: {
      name: "Газиев Гаджи Хизриевич",
    },
    services: [
      {
        code: "INSURANCE",
        parameter: "0",
      },
    ],
    tariff_code: selectedTariff,
    shipment_point: process.env.SHIPMENT_POINT!,
  };

  if (address) {
    const courierDelivery: TDeliveryRequest = {
      ...obj,
      to_location: { code: cityCode, address: address },
    };

    return courierDelivery;
  } else {
    const warehouseDelivery: TDeliveryRequest = {
      ...obj,
      delivery_point: selectedPvzCode,
    };
    return warehouseDelivery;
  }
};

export const getOrderObjInternation = async (
  access_token: string | undefined,
  uuidCdek: string,
  totalPrice: any,
  surName: string,
  firstName: string,
  middleName: string,
  phone: string,
  selectedPvzCode: string,
  selectedTariff: number,
  address: string,
  cityCode: number,
  products?: TProduct[],
): Promise<TDeliveryRequest> => {
  // Считаем количество протеинов, гейнеров и обычных товаров
  const { proteinCount, gainerCount, regularCount, totalCount } =
    products?.reduce(
      (acc, product) => {
        const count = product.productCount;
        const nameLower = product.name?.toLowerCase() || "";
        const isProtein = nameLower.includes("протеин");
        const isGainer = nameLower.includes("гейнер");

        return {
          proteinCount: acc.proteinCount + (isProtein ? count : 0),
          gainerCount: acc.gainerCount + (isGainer ? count : 0),
          regularCount:
            acc.regularCount + (!isProtein && !isGainer ? count : 0),
          totalCount: acc.totalCount + count,
        };
      },
      { proteinCount: 0, gainerCount: 0, regularCount: 0, totalCount: 0 },
    ) ?? { proteinCount: 0, gainerCount: 0, regularCount: 0, totalCount: 0 };

  // Создаём packages для международной доставки
  const createPackagesInternational = () => {
    let packages: Array<{
      number: string;
      comment: string;
      height: number;
      length: number;
      width: number;
      weight: number;
      items: Array<{
        ware_key: string;
        payment: { value: number };
        name: string;
        cost: number;
        amount: number;
        weight: number;
        weight_gross: number;
      }>;
    }> = [];
    const totalBigProds = proteinCount + gainerCount;

    // Определяем размер коробки (по той же логике)
    let sizeKey: keyof typeof SIZE_CONFIG = "XL_SIZE";

    if (totalBigProds === 0 && regularCount <= 4) {
      sizeKey = "S_SIZE";
    } else if (
      (totalBigProds === 0 && regularCount <= 20) ||
      (proteinCount === 1 && gainerCount === 0 && regularCount <= 8) ||
      (gainerCount === 1 && proteinCount === 0 && regularCount <= 6)
    ) {
      sizeKey = "M_SIZE";
    } else if (
      (totalBigProds === 0 && regularCount <= 45) ||
      (proteinCount <= 3 && gainerCount === 0 && regularCount <= 8) ||
      (gainerCount <= 2 && proteinCount === 0 && regularCount <= 7)
    ) {
      sizeKey = "L_SIZE";
    } else {
      sizeKey = "XL_SIZE";
    }

    const selectedSize = SIZE_CONFIG[sizeKey];

    // Рассчитываем веса
    const totalWeight =
      proteinCount * PROTEIN_WEIGHT +
      gainerCount * GAINER_WEIGHT +
      regularCount * AVERAGE_ITEM_WEIGHT;

    const totalWeightGross = totalWeight + WEIGHT_GROSS_MARGIN;

    // Формируем массив с одной упаковкой
    packages = [
      {
        number: "1",
        comment: `International Package (${sizeKey}, ${totalCount} items)`,
        height: selectedSize.height,
        length: selectedSize.length,
        width: selectedSize.width,
        weight: totalWeight,
        items: [
          {
            ware_key: "1",
            payment: {
              value: 0,
            },
            name: "Биологически активные добавки Triple H",
            cost: Number(totalPrice), // В Intl версии обычно передается полная стоимость
            amount: totalCount,
            weight: totalWeight,
            weight_gross: totalWeightGross,
          },
        ],
      },
    ];

    return packages;
  };

  const packages = totalCount > 0 ? createPackagesInternational() : [];

  let obj = {
    token: access_token,
    number: uuidCdek,
    type: 1,
    date_invoice: `${new Date().getFullYear()}-${String(
      new Date().getMonth() + 1,
    ).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`,
    shipper_address: "Старый Бавтугай, ул. Интернатская, 2",
    delivery_recipient_cost: {
      value: 0,
    },
    seller: {
      address: "Старый Бавтугай, ул. Интернатская, 2",
    },
    shipper_name: "Vorobei Shop",
    packages:
      packages.length > 0
        ? packages
        : [
            {
              number: "1",
              comment: "Упаковка по умолчанию",
              height: SIZE_CONFIG.S_SIZE.height,
              length: SIZE_CONFIG.S_SIZE.length,
              width: SIZE_CONFIG.S_SIZE.width,
              weight: 0,
              items: [
                {
                  ware_key: "1",
                  payment: {
                    value: 0,
                  },
                  name: "Биологически активные добавики Triple H",
                  cost: Number(totalPrice),
                  amount: 1,
                  weight: 0,
                  weight_gross: WEIGHT_GROSS_MARGIN,
                },
              ],
            },
          ],
    recipient: {
      name: `${surName} ${firstName} ${middleName}`,
      phones: [
        {
          number: phone,
        },
      ],
    },
    sender: {
      name: "Газиев Гаджи Хизриевич",
    },
    services: [
      {
        code: "INSURANCE",
        parameter: "0",
      },
    ],
    tariff_code: selectedTariff,
    shipment_point: process.env.SHIPMENT_POINT!,
  };

  if (address) {
    const courierDelivery: TDeliveryRequest = {
      ...obj,
      to_location: { code: cityCode, address: address },
    };

    return courierDelivery;
  } else {
    const warehouseDelivery: TDeliveryRequest = {
      ...obj,
      delivery_point: selectedPvzCode,
    };
    return warehouseDelivery;
  }
};

export const makeTrackNumber = async (
  body: TDeliveryRequest,
): Promise<TDeliveryResponse | undefined> => {
  try {
    const options = {
      url: `${process.env.SERVER_API_URL}/orders`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    };

    return new Promise((resolve, reject) => {
      request(options, (error, response, body) => {
        if (error) {
          console.log(error);
          reject(error);
        }

        try {
          const data = JSON.parse(body);
          resolve(data);
        } catch (parseError) {
          console.log("json parse error");
          reject(parseError);
        }
      });
    });
  } catch (err) {
    console.log(err);
    return undefined;
  }
};

export const getToken = async (
  body: TCdekUser,
): Promise<ResponseAuthData | undefined> => {
  try {
    const options = {
      url: `${process.env.SERVER_API_URL}/oauth/token`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    };

    return new Promise((resolve, reject) => {
      request(options, (error, response, body) => {
        if (error) {
          console.error(error);
          reject(error);
        }
        try {
          const data = JSON.parse(body);
          resolve(data);
        } catch (err) {
          console.log(err);
          resolve(undefined);
        }
      });
    });
  } catch (err) {
    console.log(err);
    return undefined;
  }
};
