import { HttpClientModule } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { AlliaseComponent } from './alliase/alliase.component';

@NgModule({
  declarations: [
    AppComponent,
  ],
  imports: [
    BrowserModule, HttpClientModule,
    AppRoutingModule,
    AlliaseComponent
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
