import { ChangeDetectionStrategy, Component, AfterViewInit, ElementRef, input, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

@Component({
  selector: 'app-pdf-viewer',
  imports: [CommonModule],
  template: `
    <div class="pdf-viewer-wrapper relative w-full h-full">
      <div class="pdf-container w-full h-full overflow-auto bg-slate-200 p-4" #pdfContainer>
        @if(isLoading()) {
          <div class="flex items-center justify-center h-full">
            <div class="flex items-center gap-2 text-slate-600">
              <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              <span>Loading PDF...</span>
            </div>
          </div>
        }
        @if(error(); as errorMessage) {
          <div class="flex items-center justify-center h-full">
              <div class="text-red-600 bg-red-100 p-4 rounded-md">
                  <p><strong>Error:</strong> {{ errorMessage }}</p>
              </div>
          </div>
        }
        <!-- PDF pages as canvas elements will be rendered here by renderAllPages() -->
      </div>

      <!-- Zoom Controls -->
      @if (!isLoading() && !error()) {
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-800/80 text-white rounded-full shadow-lg flex items-center gap-2 p-2 backdrop-blur-sm z-10">
          <button (click)="zoomOut()" [disabled]="scale() <= minZoom" class="w-8 h-8 rounded-full hover:bg-slate-700 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14" /></svg>
          </button>
          <span class="text-sm font-mono w-16 text-center">{{ (scale() * 100).toFixed(0) }}%</span>
          <button (click)="zoomIn()" [disabled]="scale() >= maxZoom" class="w-8 h-8 rounded-full hover:bg-slate-700 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 75vh;
    }
    .pdf-page-canvas {
        display: block;
        margin: 0 auto 1rem;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfViewerComponent implements AfterViewInit {
  pdfSrc = input.required<string>();
  
  private pdfContainerRef = viewChild.required<ElementRef<HTMLDivElement>>('pdfContainer');
  
  isLoading = signal(true);
  error = signal<string | null>(null);
  scale = signal(1.0);

  readonly minZoom = 0.25;
  readonly maxZoom = 4.0;
  private readonly zoomStep = 0.25;
  private pdfDoc: PDFDocumentProxy | null = null;

  constructor() {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.mjs`;
  }

  ngAfterViewInit(): void {
    this.loadAndRenderPdf();
  }

  zoomIn(): void {
    if (!this.pdfDoc || this.scale() >= this.maxZoom) return;
    this.scale.update(s => Math.min(this.maxZoom, s + this.zoomStep));
    this.renderAllPages();
  }

  zoomOut(): void {
    if (!this.pdfDoc || this.scale() <= this.minZoom) return;
    this.scale.update(s => Math.max(this.minZoom, s - this.zoomStep));
    this.renderAllPages();
  }
  
  private async loadAndRenderPdf(): Promise<void> {
    try {
      if (!this.pdfSrc()) {
        this.error.set('No PDF source provided.');
        this.isLoading.set(false);
        return;
      }
      
      const base64Data = this.pdfSrc().split(',')[1];
      if (!base64Data) { throw new Error('Invalid PDF data URL.'); }

      const pdfData = atob(base64Data);
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      this.pdfDoc = await loadingTask.promise;

      // Calculate initial scale to fit the container width
      const firstPage = await this.pdfDoc.getPage(1);
      const container = this.pdfContainerRef().nativeElement;
      // Subtract padding (p-4 -> 1rem each side -> 16px * 2)
      const containerWidth = container.clientWidth - 32; 
      const viewport = firstPage.getViewport({ scale: 1.0 });
      // Set initial scale, but don't exceed max zoom for very narrow PDFs
      const initialScale = Math.min(this.maxZoom, containerWidth / viewport.width);
      this.scale.set(initialScale);
      
      await this.renderAllPages();

    } catch (e: any) {
      console.error('Error loading PDF:', e);
      this.error.set(e.message || 'Failed to load PDF.');
    } finally {
        this.isLoading.set(false);
    }
  }

  private async renderAllPages(): Promise<void> {
    if (!this.pdfDoc) return;

    try {
        const container = this.pdfContainerRef().nativeElement;
        // Clear previous renders to prevent duplication
        container.innerHTML = '';

        for (let i = 1; i <= this.pdfDoc.numPages; i++) {
            const page = await this.pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: this.scale() });
            
            const canvas = document.createElement('canvas');
            canvas.className = 'pdf-page-canvas';
            const context = canvas.getContext('2d');
            
            if (!context) { throw new Error('Could not get canvas context.'); }

            canvas.height = viewport.height;
            canvas.width = viewport.width;

            container.appendChild(canvas);

            const renderContext = {
                canvasContext: context,
                viewport: viewport,
            };
            // This promise resolves when rendering is complete
            await page.render(renderContext).promise;
        }
    } catch (e: any) {
        console.error('Error rendering PDF pages:', e);
        // Don't overwrite a more specific loading error
        if (!this.error()) {
          this.error.set(e.message || 'Failed to render PDF pages.');
        }
    }
  }
}
