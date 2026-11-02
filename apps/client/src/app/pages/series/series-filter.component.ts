import { Component, Input, Output, EventEmitter, ViewChild, ViewChildren, ElementRef, QueryList, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-series-filter',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './series-filter.component.html',
  styleUrl: './series-filter.component.scss'
})
export class SeriesFilterComponent {
  private static nextId = 0;
  readonly menuId = `series-filter-${++SeriesFilterComponent.nextId}`;
  @Input() label = '';
  @Input() options: { value: string; label: string }[] = [];
  @Input() selectedValues: string[] = [];
  @Input() multiple = false;
  @Output() selectionChange = new EventEmitter<string[]>();
  @ViewChild('trigger') trigger!: ElementRef<HTMLButtonElement>;
  @ViewChildren('menuItem') menuItems!: QueryList<ElementRef<HTMLButtonElement>>;
  isOpen = false;

  constructor(private cdr: ChangeDetectorRef) {}

  get summary(): string {
    const selected = this.options.filter(option => this.selectedValues.includes(option.value));
    return selected.length > 1 ? `${selected.length} seçim` : selected[0]?.label || 'Tümü';
  }

  selected(value: string) { return this.selectedValues.includes(value) || (!value && !this.selectedValues.length); }

  open() {
    this.isOpen = true;
    this.cdr.detectChanges();
    this.focus(Math.max(0, this.options.findIndex(option => this.selected(option.value))));
  }

  close() {
    this.isOpen = false;
    this.cdr.detectChanges();
    this.trigger.nativeElement.focus();
  }

  choose(value: string) {
    const next = this.multiple
      ? this.selectedValues.includes(value) ? this.selectedValues.filter(v => v !== value) : [...this.selectedValues, value]
      : [value];
    this.selectedValues = next;
    this.selectionChange.emit(next);
    if (!this.multiple) this.close();
  }

  clear() { this.selectedValues = []; this.selectionChange.emit([]); }

  private focus(index: number) {
    const item = this.menuItems.toArray()[index]?.nativeElement;
    item?.focus();
    item?.scrollIntoView({ block: 'nearest' });
  }

  @HostListener('keydown', ['$event'])
  handleKey(event: KeyboardEvent) {
    if (!this.isOpen) {
      if (event.key === 'Enter' && document.activeElement === this.trigger?.nativeElement) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) this.open();
      }
      return;
    }
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace', 'Tab'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Backspace') { this.close(); return; }
    const items = this.menuItems.toArray();
    if (!items.length) return;
    const index = Math.max(0, items.findIndex(item => item.nativeElement === document.activeElement));
    if (event.key === 'Enter') { if (!event.repeat) items[index].nativeElement.click(); return; }
    const step = event.key === 'ArrowUp' || event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
    this.focus((index + step + items.length) % items.length);
  }
}
