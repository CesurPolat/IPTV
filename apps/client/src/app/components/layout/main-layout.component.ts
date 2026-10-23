import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from '../header/header.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, HeaderComponent],
  template: `
    <div class="layout-wrapper">
      <!-- <app-header></app-header> -->
      <main class="content">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    .layout-wrapper {
      min-height: 100vh;
      background-color: #0f0f0f;
      color: white;
    }
    .content {
      padding: 0; /* İçerik padding'i sayfalara bırakıyoruz */
    }
  `]
})
export class MainLayoutComponent {

    constructor() { 
        
    }

}
