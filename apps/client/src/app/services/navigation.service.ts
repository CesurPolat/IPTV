import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Location } from '@angular/common';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class NavigationService {
  private historyIds: number[] = [];
  private historyIndex = -1;
  private restoredId?: number;
  private replaceEntry = false;

  constructor(private router: Router, private location: Location) {
    this.router.events.subscribe(event => {
      if (event instanceof NavigationStart) {
        this.restoredId = event.restoredState?.navigationId;
        this.replaceEntry = this.router.getCurrentNavigation()?.extras.replaceUrl === true;
      } else if (event instanceof NavigationEnd) {
        if (this.restoredId !== undefined) {
          const index = this.historyIds.indexOf(this.restoredId);
          if (index >= 0) {
            this.historyIndex = index;
            this.historyIds[index] = event.id;
          } else {
            this.historyIds = [event.id];
            this.historyIndex = 0;
          }
        } else if (this.replaceEntry && this.historyIndex >= 0) {
          this.historyIds[this.historyIndex] = event.id;
        } else {
          this.historyIds.splice(this.historyIndex + 1);
          this.historyIds.push(event.id);
          this.historyIndex = this.historyIds.length - 1;
        }
      }
    });
  }

  back(fallback = '/home') {
    if (this.historyIndex > 0) this.location.back();
    else this.router.navigateByUrl(fallback, { replaceUrl: true });
  }

  private isSearchSelected = new BehaviorSubject<boolean>(false);
  isSearchSelected$ = this.isSearchSelected.asObservable();

  setSearchSelected(selected: boolean) {
    this.isSearchSelected.next(selected);
  }

  getSearchSelected() {
    return this.isSearchSelected.value;
  }
}
