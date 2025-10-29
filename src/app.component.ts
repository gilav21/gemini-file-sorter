import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { GeminiService } from './services/gemini.service';

type FileStatus = 'pending' | 'processing' | 'done' | 'error';

interface AppFile {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  safeUrl: SafeResourceUrl;
  base64Data: string;
  status: FileStatus;
  suggestion?: string; // Original AI suggestion
  finalFolder?: string; // User-controlled final choice
  tags?: string[];
  summary?: string;
  suggestedName?: string;
  useNewName: boolean;
  errorMessage?: string;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class AppComponent {
  private geminiService = inject(GeminiService);
  // FIX: Explicitly type DomSanitizer to fix type inference issue, which causes compile errors when calling its methods.
  private sanitizer: DomSanitizer = inject(DomSanitizer);

  folders = signal('Invoices, Receipts, Personal Photos, Work Documents, Travel');
  files = signal<AppFile[]>([]);
  isProcessing = signal(false);
  isDragging = signal(false);
  fileInModal = signal<AppFile | null>(null);

  foldersForSelect = computed(() => {
    const folderList = this.folders().split(',').map(f => f.trim()).filter(f => f);
    if (!folderList.find(f => f.toLowerCase() === 'miscellaneous')) {
        folderList.push('Miscellaneous');
    }
    return folderList;
  });

  // FIX: Added method to handle textarea input to avoid using $any in the template, improving type safety.
  onFoldersInput(event: Event): void {
    this.folders.set((event.target as HTMLTextAreaElement).value);
  }

  handleFileSelect(event: Event): void {
    const element = event.target as HTMLInputElement;
    const selectedFiles = element.files;
    if (selectedFiles) {
      this.processFiles(Array.from(selectedFiles));
    }
    // Reset input to allow re-selecting the same files
    if (element) element.value = '';
  }

  handleDirectorySelect(event: Event): void {
    const element = event.target as HTMLInputElement;
    const selectedFiles = element.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const allFiles = Array.from(selectedFiles);
    const folderNames = new Set<string>();
    const filesToProcess: File[] = [];
    
    // The first part of webkitRelativePath is the name of the directory selected.
    const rootPath = (allFiles[0] as any).webkitRelativePath.split('/')[0];

    for (const file of allFiles) {
      const relativePath = (file as any).webkitRelativePath;
      if (!relativePath) continue;

      // Get path relative to the selected directory by removing the root folder name.
      const pathInsideSelectedDir = relativePath.substring(rootPath.length + 1);
      if (!pathInsideSelectedDir) continue; // Skip the root folder itself if it appears as an entry

      const pathParts = pathInsideSelectedDir.split('/');

      if (pathParts.length > 1) { 
        // File is in a subdirectory, use the subdirectory name as a category.
        folderNames.add(pathParts[0]);
      } else {
        // File is directly in the selected directory.
        if (file.type.startsWith('image/') || file.type === 'application/pdf') {
          filesToProcess.push(file);
        }
      }
    }

    if (folderNames.size > 0) {
      this.folders.set(Array.from(folderNames).join(', '));
    }

    this.processFiles(filesToProcess);
    
    // Reset the input value to allow selecting the same directory again.
    if (element) element.value = '';
  }

  handleFileDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    const droppedFiles = event.dataTransfer?.files;
    if (droppedFiles) {
        this.processFiles(Array.from(droppedFiles));
    }
  }

  handleDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  handleDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  private processFiles(selectedFiles: File[]): void {
    const filesToProcess = Array.from(selectedFiles);
    const filesForSignal: AppFile[] = [];
    let processedCount = 0;

    const checkAndUpdateSignal = () => {
      processedCount++;
      if (processedCount === filesToProcess.length) {
        this.files.update(current => [...current, ...filesForSignal]);
      }
    };

    if (filesToProcess.length === 0) return;

    for (const file of filesToProcess) {
      if (file.type.startsWith('image/') || file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = (e: any) => {
          const dataUrl = e.target.result;
          const base64Data = dataUrl.split(',')[1];
          filesForSignal.push({
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl,
            safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(dataUrl),
            base64Data,
            status: 'pending',
            useNewName: true,
          });
          checkAndUpdateSignal();
        };
        reader.readAsDataURL(file);
      } else {
        filesForSignal.push({
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl: '',
            safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(''),
            base64Data: '',
            status: 'error',
            useNewName: false,
            errorMessage: 'Only image & PDF files can be analyzed.'
        });
        checkAndUpdateSignal();
      }
    }
  }


  removeFile(fileName: string): void {
    this.files.update(currentFiles => currentFiles.filter(f => f.name !== fileName));
  }

  clearAll(): void {
    this.files.set([]);
  }

  async organizeFiles(): Promise<void> {
    if (this.isProcessing() || this.files().length === 0) {
      return;
    }

    this.isProcessing.set(true);
    const folderList = this.folders().split(',').map(f => f.trim()).filter(f => f);

    if(folderList.length === 0) {
        alert('Please define at least one folder category.');
        this.isProcessing.set(false);
        return;
    }

    const filesToProcess = this.files();

    for (const file of filesToProcess) {
      if(file.status !== 'pending') continue;

      this.files.update(current =>
        current.map(f => (f.name === file.name ? { ...f, status: 'processing' } : f))
      );

      try {
        const result = await this.geminiService.analyzeFile(file, folderList);
        
        // Sanitize suggestions from Gemini to remove illegal filesystem characters.
        const suggestedFolder = this.sanitizeName(result.folder.trim());
        const suggestedFilename = this.sanitizeName(result.suggestedFilename.trim());

        // Check if the suggested folder (case-insensitively) is a new one.
        const existingFolders = this.foldersForSelect();
        const match = existingFolders.find(f => f.toLowerCase() === suggestedFolder.toLowerCase());
        
        let finalFolder: string;

        if (match) {
            // It's an existing folder, use the original casing.
            finalFolder = match;
        } else {
            // It's a new folder suggestion.
            finalFolder = suggestedFolder;
            // Add the new folder to our list of folders.
            // This will automatically update the dropdowns for all files via signals.
            this.folders.update(currentFolders => {
                const currentList = currentFolders.split(',').map(f => f.trim()).filter(f => f);
                if (!currentList.find(f => f.toLowerCase() === finalFolder.toLowerCase())) {
                    return [...currentList, finalFolder].join(', ');
                }
                return currentFolders;
            });
        }

        this.files.update(current =>
          current.map(f =>
            f.name === file.name
              ? { 
                  ...f, 
                  status: 'done', 
                  suggestion: suggestedFolder, 
                  finalFolder: finalFolder,
                  tags: result.tags, 
                  summary: result.summary, 
                  suggestedName: suggestedFilename 
                }
              : f
          )
        );
      } catch (error) {
        this.files.update(current =>
          current.map(f =>
            f.name === file.name
              ? { ...f, status: 'error', errorMessage: 'AI analysis failed.' }
              : f
          )
        );
      }
    }

    this.isProcessing.set(false);
  }

  get canOrganize(): boolean {
      return !this.isProcessing() && this.files().some(f => f.status === 'pending');
  }

  toggleUseNewName(fileName: string): void {
    this.files.update(currentFiles =>
        currentFiles.map(f =>
            f.name === fileName ? { ...f, useNewName: !f.useNewName } : f
        )
    );
  }

  updateFinalFolder(fileName: string, event: Event): void {
    const newFolder = (event.target as HTMLSelectElement).value;
    this.files.update(currentFiles =>
        currentFiles.map(f =>
            f.name === fileName ? { ...f, finalFolder: newFolder } : f
        )
    );
  }
  
  openModal(file: AppFile): void {
    if (file.status === 'error') return; // Do not open modal for files that couldn't be read
    this.fileInModal.set(file);
  }

  closeModal(): void {
    this.fileInModal.set(null);
  }

  canDownloadScript = computed(() => this.files().some(f => f.status === 'done'));

  private sanitizeName(name: string): string {
    // Windows illegal characters: < > : " / \ | ? *
    if (!name) return '';
    return name.replace(/[<>:"/\\|?*]/g, '');
  }

  generateAndDownloadScript(): void {
    const analyzedFiles = this.files().filter(f => f.status === 'done');
    if (analyzedFiles.length === 0) return;

    let scriptContent = `# AI File Organizer - PowerShell Script
# -------------------------------------
# Instructions:
# 1. Save this file as "organize-files.ps1" in the SAME directory as the files you uploaded.
# 2. Right-click the file and select "Run with PowerShell".
#
# !! If you get an error about scripts being disabled, do the following once: !!
#    a. Open the Start Menu, type "PowerShell", and open it.
#    b. Copy and paste the following command, then press Enter:
#       Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
#    c. Type 'Y' and press Enter to confirm.
#    d. You can now run the script.
# -------------------------------------\n\n`;

    scriptContent += `Write-Host "Starting file organization..." -ForegroundColor Green\n\n`;
    
    const foldersToCreate = [...new Set(
        analyzedFiles
            .map(f => f.finalFolder)
            .filter(folder => folder && folder !== '--do-not-move--')
    )] as string[];

    if (foldersToCreate.length > 0) {
        scriptContent += `# Create destination folders if they don't exist\n`;
        foldersToCreate.forEach(folder => {
            const sanitizedFolder = this.sanitizeName(folder);
            // In PowerShell, to use a single quote inside a single-quoted string, you double it.
            const safeFolder = sanitizedFolder.replace(/'/g, "''");
            scriptContent += `if (-not (Test-Path -Path '${safeFolder}')) { New-Item -ItemType Directory -Path '${safeFolder}' | Out-Null }\n`;
        });
        scriptContent += `\n`;
    }

    scriptContent += `# Process files\n`;
    analyzedFiles.forEach(file => {
        const originalName = file.name.replace(/'/g, "''");
        const suggestedName = file.suggestedName ? file.suggestedName.replace(/'/g, "''") : '';
        const newName = file.useNewName && suggestedName ? suggestedName : originalName;
        
        const destinationFolder = file.finalFolder;

        if (destinationFolder && destinationFolder !== '--do-not-move--') {
            const sanitizedDestinationFolder = this.sanitizeName(destinationFolder);
            const safeDestinationFolder = sanitizedDestinationFolder.replace(/'/g, "''");
            const destinationPath = `${safeDestinationFolder}\\${newName}`;
            scriptContent += `Write-Host "Moving '${originalName}' to '${destinationPath}'"\n`;
            scriptContent += `Move-Item -Path '${originalName}' -Destination '${destinationPath}' -Force\n`;
        } else if (file.useNewName && newName !== originalName) {
            scriptContent += `Write-Host "Renaming '${originalName}' to '${newName}'"\n`;
            scriptContent += `Rename-Item -Path '${originalName}' -NewName '${newName}'\n`;
        }
    });
    scriptContent += `\n`;
    
    scriptContent += `Write-Host "Organization complete." -ForegroundColor Green\n`;
    scriptContent += `Read-Host "Press Enter to exit..."\n`;

    // Prepend UTF-8 BOM, which is standard and well-supported by PowerShell.
    const utf8BOM = "\uFEFF";
    const blob = new Blob([utf8BOM + scriptContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'organize-files.ps1';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}