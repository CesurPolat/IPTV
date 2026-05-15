import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AppUpdateService } from '../../services/app-update.service';
import { NotificationService } from '../../services/notification.service';
import { ApkDownloadService } from '../../services/apk-download.service';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './settings.component.html',
    styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit, OnDestroy {
    private readonly archillectStorageKey = 'archillectTvEnabled';
    private readonly autoSwitchStorageKey = 'channelAutoSwitchEnabled';
    private readonly onlyLiveStorageKey = 'onlyLiveEnabled';
    isArchillectTvEnabled = true;
    isChannelAutoSwitchEnabled = false;
    isOnlyLiveEnabled = true;
    selectedSettingIndex = 0;
    hasCheckedUpdates = false;
    isCheckingUpdates = false;
    isUpdateAvailable = false;
    isAndroidPlatform = false;
    isDownloadingLatestApk = false;
    private updateStateSubscription?: Subscription;

    constructor(
        private router: Router,
        private appUpdateService: AppUpdateService,
        private notificationService: NotificationService,
        private apkDownloadService: ApkDownloadService
    ) { }

    ngOnInit(): void {
        this.isOnlyLiveEnabled = this.readOnlyLiveSetting();
        this.isArchillectTvEnabled = this.readArchillectSetting();
        this.isChannelAutoSwitchEnabled = this.readAutoSwitchSetting();
        this.isAndroidPlatform = this.apkDownloadService.isAndroidSupported();
        this.applyOnlyLiveDependencies();

        const state = this.appUpdateService.state;
        this.hasCheckedUpdates = state.hasChecked;
        this.isCheckingUpdates = state.isChecking;
        this.isUpdateAvailable = state.updateAvailable;

        this.updateStateSubscription = this.appUpdateService.state$.subscribe((nextState) => {
            this.hasCheckedUpdates = nextState.hasChecked;
            this.isCheckingUpdates = nextState.isChecking;
            this.isUpdateAvailable = nextState.updateAvailable;
        });

        if (!state.hasChecked && !state.isChecking) {
            void this.appUpdateService.checkForUpdates();
        }
    }

    ngOnDestroy(): void {
        this.updateStateSubscription?.unsubscribe();
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

    onUpdateClick(): void {
        if (!this.isUpdateAvailable || this.isCheckingUpdates) {
            return;
        }

        void this.appUpdateService.applyUpdate();
    }

    async onDownloadLatestApkClick(): Promise<void> {
        if (this.isDownloadingLatestApk) {
            return;
        }

        if (!this.isAndroidPlatform) {
            this.notificationService.showInfo('Latest APK indirme sadece Android cihazlarda desteklenir.');
            return;
        }

        this.isDownloadingLatestApk = true;
        const result = await this.apkDownloadService.downloadLatestApk();
        this.isDownloadingLatestApk = false;

        if (!result.success) {
            this.notificationService.showError(result.errorMessage ?? 'Latest APK indirilemedi.');
            return;
        }

        this.notificationService.showSuccess('Latest APK indirme baslatildi. Downloads klasorunu kontrol edin.');
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
                this.selectedSettingIndex = Math.min(4, this.selectedSettingIndex + 1);
                break;
            case 'Enter':
            case ' ':
                if (this.selectedSettingIndex === 0) {
                    this.toggleOnlyLiveSetting();
                } else if (this.selectedSettingIndex === 1) {
                    this.toggleArchillectSetting();
                } else if (this.selectedSettingIndex === 2) {
                    this.toggleAutoSwitchSetting();
                } else if (this.selectedSettingIndex === 3) {
                    this.onUpdateClick();
                } else if (this.selectedSettingIndex === 4) {
                    void this.onDownloadLatestApkClick();
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
            //this.isArchillectTvEnabled = true;
            //this.persistArchillectSetting(true);
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
