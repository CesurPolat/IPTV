import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class NavigationService {
  private isSearchSelected = new BehaviorSubject<boolean>(false);
  isSearchSelected$ = this.isSearchSelected.asObservable();

  setSearchSelected(selected: boolean) {
    this.isSearchSelected.next(selected);
  }

  getSearchSelected() {
    return this.isSearchSelected.value;
  }
}
