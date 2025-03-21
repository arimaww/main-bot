import { prisma } from "../prisma/prisma-client";

const timers = new Map(); // Объект для хранения таймеров по id заказа

export function saveTimerIdForOrder(unique: string, timerId: NodeJS.Timeout) {
    timers.set(unique, timerId);
}

export function getTimerIdForOrder(unique: string) {
    return timers.get(unique);
}

// Удаление таймера после получения скриншота
export function removeTimerIdForOrder(unique: string) {
    timers.delete(unique);
}

export async function checkOrderStatus(unique: string) {
    const order = await prisma.order.findFirst({
        where: { orderUniqueNumber: unique },
    });

    if (order?.status === "WAITPAY") {
        return { isPaid: false };
    } else if (order?.status === "PENDING") {
        onPaymentReceived(unique);
    }
    return { isPaid: true };
}

export async function onPaymentReceived(unique: string) {
    const timerId = getTimerIdForOrder(unique);
    if (timerId) {
        clearTimeout(timerId);
        removeTimerIdForOrder(unique);
    }
}