import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService, ToastMessage } from '../../services/notification.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-notification',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container">
      @for (toast of toasts$ | async; track toast.id) {
        <div class="toast" [class]="toast.type" (click)="remove(toast.id)">
          <div class="toast-content">
            <span class="icon">
              @if (toast.type === 'error') { ⚠️ }
              @else if (toast.type === 'success') { ✅ }
              @else { ℹ️ }
            </span>
            <span class="message">{{ toast.message }}</span>
          </div>
          <div class="progress-bar"></div>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      min-width: 250px;
      max-width: 350px;
      padding: 15px;
      border-radius: 8px;
      color: white;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      cursor: pointer;
      animation: slideIn 0.3s ease-out;
      position: relative;
      overflow: hidden;
    }
    .error { background: #ff4444; }
    .success { background: #00C851; }
    .info { background: #33b5e5; }
    
    .toast-content {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .icon { font-size: 1.2rem; }
    .message { font-size: 0.9rem; font-weight: 500; }

    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .progress-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 3px;
      background: rgba(255,255,255,0.3);
      width: 100%;
      animation: progress 5s linear forwards;
    }

    @keyframes progress {
      from { width: 100%; }
      to { width: 0%; }
    }
  `]
})
export class NotificationComponent {
  toasts$: Observable<ToastMessage[]>;

  constructor(private notificationService: NotificationService) {
    this.toasts$ = this.notificationService.toasts;
  }

  remove(id: number) {
    this.notificationService.removeToast(id);
  }
}
