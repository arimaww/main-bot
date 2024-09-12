export type TProduct = {
	productId: number;
	name: string;
	synonym: string;
	description: string;
	picture: string | undefined;
	count: number;
	firstLvlCost: number;
	secondLvlCost: number;
	thirdvlCost: number;
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
};

export type TRecordOrderInfo = {
	userId: number;
	surName: string;
	firstName: string;
	middleName: string;
	productId: number;
	productCount: number;
	orderTrackNumber: string;
};