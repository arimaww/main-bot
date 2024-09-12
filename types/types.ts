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
	uuid: string;
	token: string;
	deliverySum: number | undefined;
	selectedPvzCode: string;
	selectedTariff: string;
};

export type TRecordOrderInfo = {
	userId: number;
	surName: string;
	firstName: string;
	middleName: string;
	productId: number;
	productCount: number;
	orderTrackNumber?: string;
	orderUniqueNumber?: string;
};

export type TDeliveryRequest = {
	token: string | undefined;
	number: string;
	type: number;
	shipment_point: string;
	delivery_point: string;
	delivery_recipient_cost: {
		value: number;
	};
	delivery_recipient_cost_adv?: [
		{
			sum: number;
			threshold: number;
		}
	];
	packages: [
		{
			number: string;
			comment: string;
			height: number;
			items: [
				{
					ware_key: string;
					payment?: {
						value: number;
					};
					name: string;
					cost: number;
					amount: number;
					weight: number;
				}
			];
			length: number;
			weight: number;
			width: number;
		}
	];
	recipient: {
		name: string;
		phones: [
			{
				number: string;
			}
		];
	};
	sender: {
		name: string;
	};
	services: [
		{
			code: string;
			parameter: string;
		}
	];
	tariff_code: number;
};

export type TDeliveryResponse = {
    entity: {
        uuid: string
    },
    requests: [
        {
            request_uuid: string,
            type: string,
            state: string,
            date_time: Date,
            errors: [],
            warnings: []
        }
    ]
}