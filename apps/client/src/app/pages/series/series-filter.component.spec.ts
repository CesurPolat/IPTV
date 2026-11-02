import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SeriesFilterComponent } from './series-filter.component';

describe('Remote filter selection', () => {
  let fixture: ComponentFixture<SeriesFilterComponent>;
  let component: SeriesFilterComponent;
  const key = (value: string, shiftKey = false) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', {
    key: value, bubbles: true, cancelable: true, shiftKey
  }));
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SeriesFilterComponent] }).compileComponents();
    fixture = TestBed.createComponent(SeriesFilterComponent); component = fixture.componentInstance;
    component.label = 'Türler';
    component.options = [{ value: 'aksiyon', label: 'Aksiyon' }, { value: 'komedi', label: 'Komedi' }, { value: 'dram', label: 'Dram' }];
    fixture.detectChanges();
  });
  function open() { component.trigger.nativeElement.focus(); key('Enter'); fixture.detectChanges(); }

  it('opens on Enter, moves with arrows and selects without submitting a form', () => {
    spyOn(component.selectionChange, 'emit');
    open();
    expect(component.isOpen).toBeTrue();
    expect(document.activeElement!.textContent).toContain('Aksiyon');
    key('ArrowDown'); key('Enter'); fixture.detectChanges();
    expect(component.selectionChange.emit).toHaveBeenCalledWith(['komedi']);
    expect(component.isOpen).toBeFalse();
    expect(document.activeElement).toBe(component.trigger.nativeElement);
    expect(component.trigger.nativeElement.textContent).toContain('Komedi');
  });

  it('keeps multi-select open and toggles individual genres with Enter', () => {
    component.multiple = true; open();
    key('Enter'); key('ArrowRight'); key('Enter'); fixture.detectChanges();
    expect(component.selectedValues).toEqual(['aksiyon', 'komedi']);
    expect(component.isOpen).toBeTrue();
    key('Enter'); fixture.detectChanges();
    expect(component.selectedValues).toEqual(['aksiyon']);
    key('Escape');
    expect(component.isOpen).toBeFalse();
    expect(document.activeElement).toBe(component.trigger.nativeElement);
  });

  it('traps Tab, closes on Backspace and preserves the selection', () => {
    component.selectedValues = ['aksiyon']; open();
    key('Tab', true);
    expect(document.activeElement!.textContent).toContain('Tamam');
    key('Tab'); expect(document.activeElement!.textContent).toContain('Aksiyon');
    key('Backspace');
    expect(component.isOpen).toBeFalse(); expect(component.selectedValues).toEqual(['aksiyon']);
  });

  it('clears multiple selections and returns focus through the Done action', () => {
    component.multiple = true; component.selectedValues = ['aksiyon', 'komedi']; open();
    const items = component.menuItems.toArray();
    items[3].nativeElement.focus(); key('Enter'); fixture.detectChanges();
    expect(component.selectedValues).toEqual([]);
    key('ArrowDown'); key('Enter');
    expect(component.isOpen).toBeFalse(); expect(document.activeElement).toBe(component.trigger.nativeElement);
  });
});
