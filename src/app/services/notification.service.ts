import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ToastMessage {
  id: number;
  message: string;
  type: 'error' | 'success' | 'info';
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private toasts$ = new BehaviorSubject<ToastMessage[]>([]);
  toasts = this.toasts$.asObservable();
  private counter = 0;

  showError(message: string) {
    this.addToast(message, 'error');
  }

  showSuccess(message: string) {
    this.addToast(message, 'success');
  }

  showInfo(message: string) {
    this.addToast(message, 'info');
  }

  private addToast(message: string, type: 'error' | 'success' | 'info') {
    const id = ++this.counter;
    const toast = { id, message, type };
    const current = this.toasts$.value;
    this.toasts$.next([...current, toast]);

    setTimeout(() => {
      this.removeToast(id);
    }, 5000); // 5 saniye sonra kaldır
  }

  removeToast(id: number) {
    const filtered = this.toasts$.value.filter(t => t.id !== id);
    this.toasts$.next(filtered);
  }
}
