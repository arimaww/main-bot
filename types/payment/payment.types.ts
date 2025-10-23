export type TPayPaymentRequest = {
  TerminalKey: string;
  Amount: number; // В копейках
  OrderId: string;
  Description: string;
  Token: string;
  NotificationURL: string;
  SuccessURL: string;
  FailURL: string;
  Receipt: {
    Email: string;
    Phone: string;
    Taxation: string;
    Items: Array<{
      Name: string;
      Price: number;
      Quantity: number;
      Amount: number;
      Tax: string;
    }>;
  };
};

export type TPayPaymentResponse = {
  Success: boolean;
  ErrorCode: string;
  TerminalKey: string;
  Status: "NEW" | "CONFIRMED";
  PaymentId: string;
  OrderId: string;
  Amount: number;
  PaymentURL: string;
};

export type TPayPaymentCheckRequest = {
  TerminalKey: string;
  PaymentId: string;
  Token: string;
};

export type TPayPaymentCheckResponse = {
  Success: boolean;
  ErrorCode: string;
  Message: string;
  TerminalKey: string;
  Status: "CONFIRMED" | "NEW";
  PaymentId: string;
  OrderId: string;
};
