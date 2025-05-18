import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AlliaseComponent } from './alliase.component';

describe('AlliaseComponent', () => {
  let component: AlliaseComponent;
  let fixture: ComponentFixture<AlliaseComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [AlliaseComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AlliaseComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
