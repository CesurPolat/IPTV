import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './settings.component.html',
    styleUrl: './settings.component.scss'
})
export class SettingsComponent {
    private readonly archillectStorageKey = 'archillectTvEnabled';
    private readonly autoSwitchStorageKey = 'channelAutoSwitchEnabled';
    isArchillectTvEnabled = true;
    isChannelAutoSwitchEnabled = false;
    selectedSettingIndex = 0;

    constructor(private router: Router) {}

    ngOnInit(): void {
        this.isArchillectTvEnabled = this.readArchillectSetting();
        this.isChannelAutoSwitchEnabled = this.readAutoSwitchSetting();
    }

    onArchillectToggle(event: Event): void {
        const target = event.target as HTMLInputElement;
        this.isArchillectTvEnabled = target.checked;
        this.persistArchillectSetting(this.isArchillectTvEnabled);
    }

    toggleArchillectSetting(): void {
        this.isArchillectTvEnabled = !this.isArchillectTvEnabled;
        this.persistArchillectSetting(this.isArchillectTvEnabled);
    }

    onAutoSwitchToggle(event: Event): void {
        const target = event.target as HTMLInputElement;
        this.isChannelAutoSwitchEnabled = target.checked;
        this.persistAutoSwitchSetting(this.isChannelAutoSwitchEnabled);
    }

    toggleAutoSwitchSetting(): void {
        this.isChannelAutoSwitchEnabled = !this.isChannelAutoSwitchEnabled;
        this.persistAutoSwitchSetting(this.isChannelAutoSwitchEnabled);
    }

    @HostListener('window:keydown', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent): void {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Backspace'].includes(event.key)) {
            event.preventDefault();
        }

        switch (event.key) {
            case 'ArrowUp':
                this.selectedSettingIndex = Math.max(0, this.selectedSettingIndex - 1);
                break;
            case 'ArrowRight':
            case 'ArrowDown':
                this.selectedSettingIndex = Math.min(1, this.selectedSettingIndex + 1);
                break;
            case 'Enter':
            case ' ':
                if (this.selectedSettingIndex === 0) {
                    this.toggleArchillectSetting();
                } else if (this.selectedSettingIndex === 1) {
                    this.toggleAutoSwitchSetting();
                }
                break;
            case 'Backspace':
                this.router.navigate(['/home']);
                break;
        }
    }

    private readArchillectSetting(): boolean {
        try {
            const stored = localStorage.getItem(this.archillectStorageKey);
            if (stored === null) {
                return true;
            }
            return stored === 'true';
        } catch {
            return true;
        }
    }

    private persistArchillectSetting(enabled: boolean): void {
        try {
            localStorage.setItem(this.archillectStorageKey, String(enabled));
        } catch {
            // Ignore storage write issues to avoid breaking settings UI.
        }
    }

    private readAutoSwitchSetting(): boolean {
        try {
            const stored = localStorage.getItem(this.autoSwitchStorageKey);
            if (stored === null) {
                return false;
            }
            return stored === 'true';
        } catch {
            return false;
        }
    }

    private persistAutoSwitchSetting(enabled: boolean): void {
        try {
            localStorage.setItem(this.autoSwitchStorageKey, String(enabled));
        } catch {
            // Ignore storage write issues to avoid breaking settings UI.
        }
    }
}
