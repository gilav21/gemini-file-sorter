import { ChangeDetectionStrategy, Component, AfterViewInit, ElementRef, input, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

// Define the type for the global docx object to avoid using `any` and improve type safety.
declare global {
  interface Window {
    docx?: {
      renderAsync: (
        document: Blob | ArrayBuffer,
        bodyContainer: HTMLElement,
        styleContainer?: HTMLElement | null,
        options?: any
      ) => Promise<any>;
    };
  }
}

@Component({
  selector: 'app-docx-viewer',
  imports: [CommonModule],
  template: `
    <div class="docx-viewer-wrapper w-full h-full overflow-auto">
        @if(isLoading()) {
          <div class="flex items-center justify-center h-full">
            <div class="flex items-center gap-2 text-slate-600">
              <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              <span>Loading Document...</span>
            </div>
          </div>
        }
        @if(error(); as errorMessage) {
          <div class="flex items-center justify-center h-full p-4">
              <div class="text-red-600 bg-red-100 p-4 rounded-md text-center">
                  <p class="font-bold">Error rendering document</p>
                  <p class="mt-1 text-sm">{{ errorMessage }}</p>
              </div>
          </div>
        }
        <!-- docx-preview library will render the document inside this container -->
        <div #docContainer [class.hidden]="isLoading() || error()"></div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
    .docx-viewer-wrapper {
      /* The docx-preview.css file handles the document styling. 
         This wrapper provides padding and a background consistent with the modal. */
      padding: 1rem;
      box-sizing: border-box;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocxViewerComponent implements AfterViewInit {
  docBlob = input.required<Blob>();
  private docContainerRef = viewChild.required<ElementRef<HTMLDivElement>>('docContainer');
  
  isLoading = signal(true);
  error = signal<string | null>(null);

  // Use static promises to ensure scripts are only loaded once per application lifecycle,
  // even if the component is created and destroyed multiple times.
  private static jszipPromise: Promise<void> | null = null;
  private static docxPreviewPromise: Promise<void> | null = null;

  ngAfterViewInit(): void {
    this.loadAndRenderDocument();
  }
  
  private loadScript(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Don't load script if it's already in the DOM
      if (document.querySelector(`script[src="${url}"]`)) {
        return resolve();
      }
      const script = document.createElement('script');
      script.src = url;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
      document.body.appendChild(script);
    });
  }

  private async loadDependencies(): Promise<void> {
    // Load JSZip first, as it's a dependency for docx-preview
    if (!DocxViewerComponent.jszipPromise) {
      DocxViewerComponent.jszipPromise = this.loadScript('https://unpkg.com/jszip/dist/jszip.min.js');
    }
    await DocxViewerComponent.jszipPromise;

    // Then load docx-preview
    if (!DocxViewerComponent.docxPreviewPromise) {
      DocxViewerComponent.docxPreviewPromise = this.loadScript('https://cdn.jsdelivr.net/npm/docx-preview@0.3.2/dist/docx-preview.min.js');
    }
    await DocxViewerComponent.docxPreviewPromise;
  }

  private async loadAndRenderDocument(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    
    const blob = this.docBlob();
    if (!blob) {
      this.error.set('No document data provided.');
      this.isLoading.set(false);
      return;
    }

    try {
      // Ensure both scripts are loaded before proceeding
      await this.loadDependencies();

      // Safeguard check to ensure the library is available on the window object
      if (typeof window.docx?.renderAsync !== 'function') {
        throw new Error('The document preview library is not available on the window object after loading.');
      }
      
      const container = this.docContainerRef().nativeElement;
      // Clear any previous content from the container
      container.innerHTML = '';
      
      // Render the document
      await window.docx.renderAsync(blob, container);

    } catch (e: any) {
      console.error('Error rendering .docx file:', e);
      this.error.set(e.message || 'An unknown error occurred while rendering the document.');
    } finally {
      this.isLoading.set(false);
    }
  }
}