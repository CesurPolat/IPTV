declare module 'bridge' {
  export const channel: {
    addListener(event: string, listener: (message: string) => void): void;
    send(event: string, ...args: unknown[]): void;
  };
}
