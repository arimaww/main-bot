import { prisma } from "../prisma/prisma-client";
import { TProduct } from "../types/types";

export async function getOrderData(orderId: string) {
    // Предполагаем, что данные заказов хранятся в базе данных
    const order = await prisma.order.findFirst({
        where: { orderUniqueNumber: orderId },
    });

    const entireOrders = await prisma.order.findMany({
        where: { orderUniqueNumber: orderId },
    });

    if (!order) {
        throw new Error("Заказ не найден");
    }

    const user = await prisma.user.findFirst({
        where: { userId: order?.userId! },
    });

    const products = await prisma.product.findMany();

    const orderProds: TProduct[] = [];

    for (const order of entireOrders) {
        products.map((prod) => {
            if (prod.productId === order.productId && order.productCount > 0) {
                orderProds.push({
                    cost: Number(prod.cost),
                    count: prod.count,
                    productId: 0,
                    name: prod.name,
                    synonym: prod.synonym || "",
                    description: prod.description,
                    picture: prod.picture || "",
                    productCount: order.productCount,
                });
            }
        });
    }
    const promocode =
        order?.promocodeId &&
        (await prisma.promocodes.findFirst({
            where: { promocodeId: order?.promocodeId },
        }));

    return {
        telegramId: user?.telegramId,
        trackNumber: order?.orderTrackNumber,
        im_number: order?.orderUniqueNumber,
        products: orderProds,
        surName: order?.surName,
        firstName: order?.firstName,
        middleName: order?.middleName,
        phone: order?.phone,
        selectedPvzCode: order?.selectedPvzCode,
        selectedTariff: order?.selectedTariff,
        totalPrice: order?.totalPrice,
        totalPriceWithDiscount: order?.totalPriceWithDiscount,
        deliveryCost: order?.deliveryCost,
        username: user?.userName,
        selectedCountry: order?.selectedCountry,
        status: order?.status,
        fileId: order?.fileId,
        cityName: order?.city,
        secretDiscountPercent: order?.secretDiscountPercent,
        address: order?.address,
        country: order?.selectedCountry,
        region: order?.region,
        index: order?.index,
        pvzCode: order?.pvzCode,
        commentByUser: order?.commentByClient,
        promocode: promocode,
        freeDelivery: order?.freeDelivery,
    };
}