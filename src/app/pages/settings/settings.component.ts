import { AfterViewInit, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AppUpdateService } from '../../services/app-update.service';
import { NotificationService } from '../../services/notification.service';
import { ApkDownloadService } from '../../services/apk-download.service';
import { Channel, TvChannelFilterMode, TvChannelsService } from '../../services/tv-channels.service';

@Component({
    selector: 'app-settings',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './settings.component.html',
    styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit, AfterViewInit, OnDestroy {
    private readonly archillectStorageKey = 'archillectTvEnabled';
    private readonly autoSwitchStorageKey = 'channelAutoSwitchEnabled';
    private readonly onlyLiveStorageKey = 'onlyLiveEnabled';
    private readonly baseSettingCount = 6;
    isArchillectTvEnabled = true;
    isChannelAutoSwitchEnabled = false;
    isOnlyLiveEnabled = true;
    tvChannelFilterMode: TvChannelFilterMode = 'all';
    availableTvChannels: Channel[] = [];
    isChannelFilterExpanded = false;
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
        private apkDownloadService: ApkDownloadService,
        private tvChannelsService: TvChannelsService
    ) { }

    ngOnInit(): void {
        this.isOnlyLiveEnabled = this.readOnlyLiveSetting();
        this.isArchillectTvEnabled = this.readArchillectSetting();
        this.isChannelAutoSwitchEnabled = this.readAutoSwitchSetting();
        this.tvChannelFilterMode = this.tvChannelsService.getTvChannelFilterMode();
        this.isAndroidPlatform = this.apkDownloadService.isAndroidSupported();
        this.applyOnlyLiveDependencies();
        this.loadAvailableTvChannels();

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

    ngAfterViewInit(): void {
        this.scheduleScrollToSelected();
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

    toggleChannelFilterExpanded(): void {
        this.isChannelFilterExpanded = !this.isChannelFilterExpanded;
        if (!this.isChannelFilterExpanded && this.selectedSettingIndex > this.baseSettingCount - 1) {
            this.selectedSettingIndex = this.baseSettingCount - 1;
        }

        this.scheduleScrollToSelected();
    }

    setTvChannelFilterMode(mode: TvChannelFilterMode): void {
        this.tvChannelFilterMode = mode;
        this.tvChannelsService.setTvChannelFilterMode(mode);
        this.scheduleScrollToSelected();
    }

    cycleTvChannelFilterMode(): void {
        const modes: TvChannelFilterMode[] = ['all', 'include', 'exclude'];
        const currentIndex = modes.indexOf(this.tvChannelFilterMode);
        this.setTvChannelFilterMode(modes[(currentIndex + 1) % modes.length]);
    }

    toggleTvChannelSelection(channel: Channel): void {
        this.tvChannelsService.toggleTvChannelSelection(channel);
        this.scheduleScrollToSelected();
    }

    isTvChannelSelected(channel: Channel): boolean {
        return this.tvChannelsService.isTvChannelSelected(channel);
    }

    get channelFilterSummary(): string {
        const selectedCount = this.tvChannelsService.getSelectedTvChannelIds().length;

        if (this.tvChannelFilterMode === 'include') {
            return selectedCount > 0
                ? `${selectedCount} kanal include listesinde.`
                : 'Include modu acik, henuz kanal secilmedi.';
        }

        if (this.tvChannelFilterMode === 'exclude') {
            return selectedCount > 0
                ? `${selectedCount} kanal exclude listesinde.`
                : 'Exclude modu acik, henuz kanal secilmedi.';
        }

        return selectedCount > 0
            ? `${selectedCount} kanal secili, filtre pasif.`
            : 'Tum TV kanallari aktif.';
    }

    get modeSelectionIndex(): number {
        return this.baseSettingCount;
    }

    get channelListStartIndex(): number {
        return this.baseSettingCount + 1;
    }

    get maxSelectableIndex(): number {
        if (!this.isChannelFilterExpanded) {
            return this.baseSettingCount - 1;
        }

        return this.channelListStartIndex + this.availableTvChannels.length - 1;
    }

    isChannelIndexSelected(index: number): boolean {
        return this.selectedSettingIndex === this.channelListStartIndex + index;
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
                this.scheduleScrollToSelected();
                break;
            case 'ArrowRight':
            case 'ArrowDown':
                this.selectedSettingIndex = Math.min(this.maxSelectableIndex, this.selectedSettingIndex + 1);
                this.scheduleScrollToSelected();
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
                } else if (this.selectedSettingIndex === 5) {
                    this.toggleChannelFilterExpanded();
                } else if (this.selectedSettingIndex === this.modeSelectionIndex) {
                    this.cycleTvChannelFilterMode();
                } else {
                    const channel = this.availableTvChannels[this.selectedSettingIndex - this.channelListStartIndex];
                    if (channel) {
                        this.toggleTvChannelSelection(channel);
                    }
                }
                break;
            case 'Backspace':
                this.router.navigate(['/home']);
                break;
        }
    }

    private loadAvailableTvChannels(): void {
        this.tvChannelsService.getAvailableTvChannels().subscribe({
            next: (channels) => {
                this.availableTvChannels = [...channels].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
                this.scheduleScrollToSelected();
            },
            error: () => {
                this.availableTvChannels = [];
            }
        });
    }

    private scheduleScrollToSelected(): void {
        setTimeout(() => this.scrollToSelectedSetting());
    }

    private scrollToSelectedSetting(): void {
        const selectedElement = document.querySelector<HTMLElement>(`[data-setting-index="${this.selectedSettingIndex}"]`);
        if (!selectedElement) {
            return;
        }

        selectedElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
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
