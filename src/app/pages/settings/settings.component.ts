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
    private readonly onlyLiveStorageKey = 'onlyLiveEnabled';
    isArchillectTvEnabled = true;
    isChannelAutoSwitchEnabled = false;
    isOnlyLiveEnabled = true;
    selectedSettingIndex = 0;

    constructor(private router: Router) {}

    ngOnInit(): void {
        this.isOnlyLiveEnabled = this.readOnlyLiveSetting();
        this.isArchillectTvEnabled = this.readArchillectSetting();
        this.isChannelAutoSwitchEnabled = this.readAutoSwitchSetting();
        this.applyOnlyLiveDependencies();
    }

    onOnlyLiveToggle(event: Event): void {
        const target = event.target as HTMLInputElement;
        this.isOnlyLiveEnabled = target.checked;
        this.persistOnlyLiveSetting(this.isOnlyLiveEnabled);
        this.applyOnlyLiveDependencies();
    }

    toggleOnlyLiveSetting(): void {
        this.isOnlyLiveEnabled = !this.isOnlyLiveEnabled;
        this.persistOnlyLiveSetting(this.isOnlyLiveEnabled);
        this.applyOnlyLiveDependencies();
    }

    onArchillectToggle(event: Event): void {
        if (!this.isOnlyLiveEnabled) {
            return;
        }
        const target = event.target as HTMLInputElement;
        this.isArchillectTvEnabled = target.checked;
        this.persistArchillectSetting(this.isArchillectTvEnabled);
    }

    toggleArchillectSetting(): void {
        if (!this.isOnlyLiveEnabled) {
            return;
        }
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
                this.selectedSettingIndex = Math.min(2, this.selectedSettingIndex + 1);
                break;
            case 'Enter':
            case ' ':
                if (this.selectedSettingIndex === 0) {
                    this.toggleOnlyLiveSetting();
                } else if (this.selectedSettingIndex === 1) {
                    this.toggleArchillectSetting();
                } else if (this.selectedSettingIndex === 2) {
                    this.toggleAutoSwitchSetting();
                }
                break;
            case 'Backspace':
                this.router.navigate(['/home']);
                break;
        }
    }

    private readOnlyLiveSetting(): boolean {
        try {
            const stored = localStorage.getItem(this.onlyLiveStorageKey);
            if (stored === null) {
                return true;
            }
            return stored === 'true';
        } catch {
            return true;
        }
    }

    private persistOnlyLiveSetting(enabled: boolean): void {
        try {
            localStorage.setItem(this.onlyLiveStorageKey, String(enabled));
        } catch {
            // Ignore storage write issues to avoid breaking settings UI.
        }
    }

    private applyOnlyLiveDependencies(): void {
        if (this.isOnlyLiveEnabled) {
            this.isArchillectTvEnabled = true;
            this.persistArchillectSetting(true);
            return;
        }

        this.isArchillectTvEnabled = false;
        this.persistArchillectSetting(false);
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
