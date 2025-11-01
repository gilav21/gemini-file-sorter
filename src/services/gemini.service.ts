import { Injectable } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';

export interface FileForProcessing {
  name: string;
  type: string;
  dataUrl: string;
  base64Data: string;
}

export interface AnalysisResult {
  folder: string;
  tags: string[];
  summary: string;
  suggestedFilename: string;
}

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private genAI: GoogleGenAI;

  constructor() {
    // This is a placeholder for the API key.
    // In a real Applet environment, process.env.API_KEY is populated.
    const apiKey = (window as any).process?.env?.API_KEY ?? 'YOUR_API_KEY_PLACEHOLDER';
    if (apiKey === 'YOUR_API_KEY_PLACEHOLDER') {
        console.warn('Using a placeholder API key for Gemini. Please ensure the environment variable is set.');
    }
    this.genAI = new GoogleGenAI({ apiKey });
  }

  async analyzeFile(
    file: FileForProcessing,
    folders: string[]
  ): Promise<AnalysisResult> {
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        throw new Error('Only image and PDF files can be processed.');
    }

    try {
      const prompt = `You are an expert multi-lingual file organizer. Your primary task is to analyze the provided file and provide categorization details IN THE SAME LANGUAGE as the file's content.

**CRITICAL INSTRUCTIONS:**
1.  **Detect Language:** First, determine the primary language of the text content within the file. If the file is an image with no text, use the language of the original filename ("${file.name}") as a guide, or default to English if unsure.
2.  **Respond in Detected Language:** ALL of your text-based outputs (folder, tags, summary, suggested filename) MUST be in the language you detected in step 1.

**Analysis Steps:**
The available folders are: ${folders.join(', ')}. These might be in a different language; use them as a reference but prioritize creating logical categories in the detected content language.

1.  **Analyze Content:** Analyze the content of the file.
2.  **Choose Folder:** Choose the single most appropriate folder. If the existing folders fit, use one. If not, suggest a NEW folder name in the detected language. The folder name MUST be filesystem-friendly and not contain illegal characters for Windows filenames (e.g., < > : " / \\ | ? *).
3.  **Generate Tags:** Generate a list of 3-5 relevant tags in the detected language.
4.  **Create Summary/Caption:** Create a concise summary (for documents) or a descriptive caption (for images) in the detected language.
5.  **Suggest Filename:** Suggest a new, filesystem-friendly filename in the detected language. It should be descriptive, use hyphens or underscores as separators (kebab-case or snake_case), and MUST preserve the original file extension. It MUST NOT contain any illegal characters for Windows filenames.

Respond with a JSON object.`;
      
      const filePart = {
        inlineData: {
          mimeType: file.type,
          data: file.base64Data,
        },
      };

      const textPart = { text: prompt };

      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [filePart, textPart] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    folder: {
                        type: Type.STRING,
                        description: `The suggested folder, IN THE DETECTED LANGUAGE of the file content. This must be filesystem-friendly and not contain illegal characters (< > : " / \\ | ? *). This can be one of [${folders.join(', ')}] or a new folder name if none are suitable.`
                    },
                    tags: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'A list of 3-5 relevant tags, IN THE DETECTED LANGUAGE of the file content.'
                    },
                    summary: {
                        type: Type.STRING,
                        description: 'A summary for documents or a caption for images, IN THE DETECTED LANGUAGE of the file content.'
                    },
                    suggestedFilename: {
                        type: Type.STRING,
                        description: `A descriptive, filesystem-friendly filename IN THE DETECTED LANGUAGE that preserves the original extension from "${file.name}". It MUST NOT contain any illegal characters for Windows filenames (< > : " / \\ | ? *).`
                    }
                },
                required: ['folder', 'tags', 'summary', 'suggestedFilename']
            }
        }
      });

      const resultJson = response.text.trim();
      const result: AnalysisResult = JSON.parse(resultJson);
      
      return result;

    } catch (error) {
      console.error('Error calling Gemini API:', error);
      throw new Error('Failed to get analysis from Gemini.');
    }
  }
}