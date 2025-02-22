import { Request, Response } from "express";


export const orderEdit = async (req: Request, res: Response) => {
    try{
        console.log('заказ отредактирован')
    }catch(err) {
        console.log(err)
    }
}