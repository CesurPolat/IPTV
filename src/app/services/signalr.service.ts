import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class SignalrService {
  private hubConnection: signalR.HubConnection | undefined;
  public connectionStatus$ = new BehaviorSubject<string>('Disconnected');

  constructor() { }

  public startConnection(hubUrl: string): void {
    this.hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets
      })
      .withAutomaticReconnect()
      .build();

    this.hubConnection
      .start()
      .then(() => {
        console.log('SignalR connection started');
        this.connectionStatus$.next('Connected');
      })
      .catch(err => {
        console.error('Error while starting SignalR connection: ' + err);
        this.connectionStatus$.next('Error');
      });

    this.hubConnection.onclose(() => {
      this.connectionStatus$.next('Disconnected');
    });

    this.hubConnection.onreconnecting(() => {
      this.connectionStatus$.next('Reconnecting');
    });

    this.hubConnection.onreconnected(() => {
      this.connectionStatus$.next('Connected');
    });
  }

  public stopConnection(): void {
    if (this.hubConnection) {
      this.hubConnection.stop()
        .then(() => {
          this.connectionStatus$.next('Disconnected');
        })
        .catch(err => console.error('Error while stopping SignalR connection: ' + err));
    }
  }

  public addListener(methodName: string, callback: (...args: any[]) => void): void {
    if (this.hubConnection) {
      this.hubConnection.on(methodName, callback);
    }
  }

  public removeListener(methodName: string): void {
    if (this.hubConnection) {
      this.hubConnection.off(methodName);
    }
  }

  public invoke(methodName: string, ...args: any[]): Promise<any> {
    if (this.hubConnection) {
      return this.hubConnection.invoke(methodName, ...args);
    }
    return Promise.reject('Hub connection not established');
  }
}
