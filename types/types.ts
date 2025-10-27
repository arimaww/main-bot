export type TProduct = {
  productId: number;
  name: string;
  synonym: string;
  description: string;
  picture: string | undefined;
  count: number;
  cost: number;
  productCount: number;
};

export type TWeb = {
  telegramId: number;
  basket: any;
  queryId: string;
  totalPrice: number;
  surName: string;
  firstName: string;
  middleName: string;
  phone: string;
  products: TProduct[];
  address: string;
  uuid: string;
  selectedCountry: string | undefined;
  deliverySum: number | undefined;
  selectedPvzCode: string;
  selectedTariff: string;
  selectedCity: string;
  promocodeId: number;
  selectedCityName: string;
  bank: string;
  totalPriceWithDiscount: number | undefined;
  secretDiscountId: number | undefined;
  selectedCityCode: number | undefined;
  commentByUser: string | null;
};

export type TRecordOrderInfo = {
  userId: number;
  surName: string;
  firstName: string;
  middleName: string;
  productId: number;
  productCount: number;
  phone: string;
  deliveryCost: number;
  orderTrackNumber?: string;
  orderUniqueNumber?: string;
  selectedPvzCode?: string;
  selectedTariff?: number;
  bankId: number;
  totalPrice: number;
  selectedCountry: string | undefined;
  orderType: "CDEK";
  city: string;
  totalPriceWithDiscount: number | null;
  productCostWithDiscount: number | null;
};

export type TDeliveryBase = {
  token: string | undefined;
  number: string;
  type: number;
  date_invoice?: string;
  shipper_address?: string;
  shipment_point: string;
  shipper_name?: string;
  seller?: {
    address: string;
  };
  delivery_recipient_cost: {
    value: number;
  };
  delivery_recipient_cost_adv?: Array<{
    sum: number;
    threshold: number;
  }>;
  packages: Array<{
    number: string;
    comment: string;
    height: number;
    items: Array<{
      ware_key: string;
      payment?: {
        value: number;
      };
      name: string;
      cost: number;
      amount: number;
      weight: number;
      weight_gross?: number;
    }>;

    length: number;
    weight: number;
    width: number;
  }>;
  recipient: {
    name: string;
    phones: Array<{
      number: string;
    }>;
  };
  sender: {
    name: string;
  };
  services: Array<{
    code: string;
    parameter: string;
  }>;
  tariff_code: number;
};

export type TDeliveryResponse = {
  entity: {
    uuid: string;
  };
  requests: [
    {
      request_uuid: string;
      type: string;
      state: string;
      date_time: Date;
      errors: [];
      warnings: [];
    },
  ];
};

type TDeliveryCourier = {
  to_location: { code: number; address: string };
  delivery_point?: never;
};

type TDeliveryWarehouse = {
  delivery_point: string;
  to_location?: never;
};

export type TDeliveryRequest = TDeliveryBase &
  (TDeliveryCourier | TDeliveryWarehouse);

export type TCdekUser = {
  grant_type: "client_credentials";
  client_id: string;
  client_secret: string;
};

export type ResponseAuthData = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  jti: string;
};
