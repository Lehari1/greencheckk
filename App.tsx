import React, { useState, useRef, useEffect } from 'react';
import { checkSustainability } from './services/geminiService'; // Assuming a service for API calls
import { jsPDF } from 'jspdf'; // Import jsPDF

interface GroundingUrl {
  uri: string;
  title: string;
}

interface ParsedResult {
  icon: string;
  overallVerdict: string;
  greenwashingRisk: string;
  claimsFailed: string[];
  whyClaimsFailed: string[];
  ingredientsToNote: string[];
  moreDetails: string;
  ingredientSpecificDetails: { name: string; explanation: string }[];
  improvementSuggestions: string[];
  groundingUrls: GroundingUrl[]; // New field for search grounding URLs
}

// Constant for the specific irrelevant input message from the AI
const IRRELEVANT_INPUT_MESSAGE = `Input not recognized as a product label.
Please paste a product’s ingredient list or upload a clear image of the ingredient label to run a sustainability check.
For example: ingredients, material lists, or sustainability claims printed on packaging.`;

// Helper to parse the plain text AI response into a structured object
const parseSustainabilityResult = (rawText: string): ParsedResult | null => {
  if (!rawText || rawText.trim() === IRRELEVANT_INPUT_MESSAGE.trim()) {
    return null; // Don't parse if rawText is empty or the irrelevant input message
  }

  const result: ParsedResult = { // Initialize all properties here
    icon: '',
    overallVerdict: '',
    greenwashingRisk: '',
    claimsFailed: [],
    whyClaimsFailed: [],
    ingredientsToNote: [],
    moreDetails: '',
    ingredientSpecificDetails: [],
    improvementSuggestions: [],
    groundingUrls: [],
  };
  const lines = rawText.split('\n');
  let currentSection: keyof ParsedResult | null = null;
  let ingredientDetailName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('❌') || line.startsWith('🟠') || line.startsWith('✅')) {
      result.icon = line.split(' ')[0];
    } else if (line.startsWith('Overall Verdict:')) {
      result.overallVerdict = lines[++i].trim();
      currentSection = null;
    } else if (line.startsWith('Greenwashing Risk:')) {
      result.greenwashingRisk = lines[++i].trim();
      currentSection = null;
    } else if (line.startsWith('Claims that failed to meet expectations:')) {
      currentSection = 'claimsFailed';
    } else if (line.startsWith('Why these claims failed:')) {
      currentSection = 'whyClaimsFailed';
    } else if (line.startsWith('Ingredients to note:')) {
      currentSection = 'ingredientsToNote';
    } else if (line.startsWith('More details:')) {
      currentSection = 'moreDetails';
    } else if (line.startsWith('Ingredient-specific details:')) {
      currentSection = 'ingredientSpecificDetails';
    } else if (line.startsWith('Improvement suggestions:')) {
      currentSection = 'improvementSuggestions';
    } else if (currentSection) {
      if (currentSection === 'claimsFailed' && line.startsWith('- ')) {
        result.claimsFailed.push(line.substring(2).trim());
      } else if (currentSection === 'whyClaimsFailed' && line.startsWith('- ')) {
        result.whyClaimsFailed.push(line.substring(2).trim());
      } else if (currentSection === 'ingredientsToNote' && line.startsWith('- ')) {
        result.ingredientsToNote.push(line.substring(2).trim());
      } else if (currentSection === 'moreDetails' && line) {
        result.moreDetails += line + '\n';
      } else if (currentSection === 'ingredientSpecificDetails') {
        if (line.endsWith(':')) {
          ingredientDetailName = line.slice(0, -1).trim();
          if (ingredientDetailName) {
            result.ingredientSpecificDetails.push({ name: ingredientDetailName, explanation: '' });
          }
        } else if (ingredientDetailName && line) {
          const lastIndex = result.ingredientSpecificDetails.length - 1;
          if (lastIndex >= 0) {
            result.ingredientSpecificDetails[lastIndex].explanation += line + '\n';
          }
        }
      } else if (currentSection === 'improvementSuggestions' && line.startsWith('- ')) {
        result.improvementSuggestions.push(line.substring(2).trim());
      }
    }
  }

  // Clean up multiline sections for display
  if (result.moreDetails) result.moreDetails = result.moreDetails.trim();
  if (result.ingredientSpecificDetails) {
    result.ingredientSpecificDetails = result.ingredientSpecificDetails.map(item => ({
      ...item,
      explanation: item.explanation.trim()
    }));
  }

  return result;
};


const App: React.FC = () => {
  const [productInput, setProductInput] = useState<string>('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null); // New state for image preview URL
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<string | null>(null); // Raw AI response
  const [parsedResult, setParsedResult] = useState<ParsedResult | null>(null); // Parsed structured AI response
  const [irrelevantInputMessage, setIrrelevantInputMessage] = useState<string | null>(null); // State for irrelevant input message
  const [error, setError] = useState<string | null>(null);

  const [showMoreDetails, setShowMoreDetails] = useState<boolean>(false);
  const [showIngredientSpecificDetails, setShowIngredientSpecificDetails] = useState<boolean>(false);
  const [showImprovementSuggestions, setShowImprovementSuggestions] = useState<boolean>(false);
  const [showGroundingUrls, setShowGroundingUrls] = useState<boolean>(false); // New state for grounding URLs

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null); // Ref for the results section

  // Effect to clean up object URL when component unmounts or previewUrl changes
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Effect to scroll to results when parsedResult becomes available
  useEffect(() => {
    if (parsedResult && resultsRef.current && !irrelevantInputMessage) { // Only scroll if it's a valid parsed result
      resultsRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [parsedResult, irrelevantInputMessage]);


  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setProductInput(e.target.value);
    setResult(null); // Clear previous result
    setParsedResult(null);
    setIrrelevantInputMessage(null); // Clear irrelevant message
    setError(null); // Clear previous error
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl); // Revoke previous URL to prevent memory leaks
    }
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file)); // Create new object URL for preview
      setResult(null); // Clear previous result
      setParsedResult(null);
      setIrrelevantInputMessage(null); // Clear irrelevant message
      setError(null); // Clear previous error
    } else {
      setImageFile(null);
      setPreviewUrl(null);
    }
  };

  const handleImageUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveImage = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setImageFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Clear the file input element itself
    }
    setResult(null); // Clear previous result
    setParsedResult(null);
    setIrrelevantInputMessage(null); // Clear irrelevant message
    setError(null); // Clear previous error
  };

  const handleClearAll = () => {
    setProductInput('');
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setImageFile(null);
    setPreviewUrl(null);
    setResult(null);
    setParsedResult(null);
    setIrrelevantInputMessage(null); // Clear irrelevant message
    setError(null);
    setShowMoreDetails(false);
    setShowIngredientSpecificDetails(false);
    setShowImprovementSuggestions(false);
    setShowGroundingUrls(false); // Clear grounding URL visibility
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Clear the file input element itself
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);
    setParsedResult(null);
    setIrrelevantInputMessage(null); // Clear previous irrelevant message
    setError(null);
    setShowMoreDetails(false); // Collapse sections on new submission
    setShowIngredientSpecificDetails(false);
    setShowImprovementSuggestions(false);
    setShowGroundingUrls(false); // Collapse grounding URLs on new submission

    try {
      if (!productInput && !imageFile) {
        setError("Please provide either text input or an image.");
        return;
      }
      const response = await checkSustainability(productInput, imageFile);

      if (response.text.trim() === IRRELEVANT_INPUT_MESSAGE.trim()) {
        setIrrelevantInputMessage(response.text);
        setParsedResult(null); // Ensure no parsed result is shown
      } else {
        const parsed = parseSustainabilityResult(response.text);
        if (parsed) {
          // Merge grounding URLs into the parsed result
          parsed.groundingUrls = response.groundingUrls;
        }
        setResult(response.text);
        setParsedResult(parsed);
      }
    } catch (err: any) {
      setError(`Failed to check sustainability: ${err.message || 'Unknown error'}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const generatePdfReport = () => {
    if (!parsedResult) return;

    const doc = new jsPDF();
    let y = 10; // Initial Y position
    const margin = 10;
    const lineHeight = 7; // Approx height per line
    const sectionSpacing = 10;
    const pageWidth = doc.internal.pageSize.width;
    const textWidth = pageWidth - 2 * margin;

    // Header
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`${parsedResult.icon} Sustainability Check Result`, margin, y);
    y += lineHeight * 2;

    // Overall Verdict
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Overall Verdict:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(parsedResult.overallVerdict, margin + doc.getTextWidth('Overall Verdict: '), y);
    y += lineHeight;

    // Greenwashing Risk
    doc.setFont('helvetica', 'bold');
    doc.text('Greenwashing Risk:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(parsedResult.greenwashingRisk, margin + doc.getTextWidth('Greenwashing Risk: '), y);
    y += lineHeight + sectionSpacing;

    // Claims that failed to meet expectations
    if (parsedResult.claimsFailed && parsedResult.claimsFailed.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Claims that failed to meet expectations:', margin, y);
      y += lineHeight;
      doc.setFont('helvetica', 'normal');
      parsedResult.claimsFailed.forEach(claim => {
        if (y + lineHeight > doc.internal.pageSize.height - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(`- ${claim}`, margin + 5, y);
        y += lineHeight;
      });
      y += sectionSpacing;
    } else {
      doc.setFont('helvetica', 'bold');
      doc.text('Claims that failed to meet expectations:', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text('None', margin + doc.getTextWidth('Claims that failed to meet expectations: ') + 2, y);
      y += lineHeight + sectionSpacing;
    }

    // Why these claims failed
    if (parsedResult.whyClaimsFailed && parsedResult.whyClaimsFailed.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Why these claims failed:', margin, y);
      y += lineHeight;
      doc.setFont('helvetica', 'normal');
      parsedResult.whyClaimsFailed.forEach(reason => {
        if (y + lineHeight > doc.internal.pageSize.height - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(`- ${reason}`, margin + 5, y);
        y += lineHeight;
      });
      y += sectionSpacing;
    } else {
      doc.setFont('helvetica', 'bold');
      doc.text('Why these claims failed:', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text('All claims appear reasonable or are well-supported by ingredients.', margin + doc.getTextWidth('Why these claims failed: ') + 2, y);
      y += lineHeight + sectionSpacing;
    }

    // Ingredients to note
    if (parsedResult.ingredientsToNote && parsedResult.ingredientsToNote.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Ingredients to note:', margin, y);
      y += lineHeight;
      doc.setFont('helvetica', 'normal');
      parsedResult.ingredientsToNote.forEach(ingredient => {
        if (y + lineHeight > doc.internal.pageSize.height - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(`- ${ingredient}`, margin + 5, y);
        y += lineHeight;
      });
      y += sectionSpacing;
    } else {
      doc.setFont('helvetica', 'bold');
      doc.text('Ingredients to note:', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text('None', margin + doc.getTextWidth('Ingredients to note: ') + 2, y);
      y += lineHeight + sectionSpacing;
    }


    // More details
    if (parsedResult.moreDetails) {
      doc.setFont('helvetica', 'bold');
      doc.text('More details:', margin, y);
      y += lineHeight;
      doc.setFont('helvetica', 'normal');
      const splitText = doc.splitTextToSize(parsedResult.moreDetails, textWidth);
      splitText.forEach((line: string) => {
        if (y + lineHeight > doc.internal.pageSize.height - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += lineHeight;
      });
      y += sectionSpacing;
    }

    // Ingredient-specific details
    if (parsedResult.ingredientSpecificDetails && parsedResult.ingredientSpecificDetails.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Ingredient-specific details:', margin, y);
      y += lineHeight;
      doc.setFont('helvetica', 'normal');
      parsedResult.ingredientSpecificDetails.forEach(item => {
        if (y + lineHeight * 2 > doc.internal.pageSize.height - margin) { // Check for name and at least one line of explanation
          doc.addPage();
          y = margin;
        }
        doc.text(`${item.name}:`, margin + 5, y);
        y += lineHeight;
        const splitExplanation = doc.splitTextToSize(item.explanation, textWidth - 10); // indent explanation
        splitExplanation.forEach((line: string) => {
          if (y + lineHeight > doc.internal.pageSize.height - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(line, margin + 10, y); // Further indent
          y += lineHeight;
        });
        y += lineHeight / 2; // Small gap between ingredients
      });
      y += sectionSpacing;
    }

    // Improvement suggestions
    if (parsedResult.improvementSuggestions && parsedResult.improvementSuggestions.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Improvement suggestions:', margin, y);
      y += lineHeight;
      doc.setFont('helvetica', 'normal');
      parsedResult.improvementSuggestions.forEach(suggestion => {
        if (y + lineHeight > doc.internal.pageSize.height - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(`- ${suggestion}`, margin + 5, y);
        y += lineHeight;
      });
      y += sectionSpacing;
    }

    // Grounding URLs
    if (parsedResult.groundingUrls && parsedResult.groundingUrls.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Source Information:', margin, y);
      y += lineHeight;
      doc.setFont('helvetica', 'normal');
      parsedResult.groundingUrls.forEach(url => {
        if (y + lineHeight * 2 > doc.internal.pageSize.height - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(url.title || url.uri, margin + 5, y);
        doc.setTextColor(0, 0, 255); // Blue for links
        doc.textWithLink(url.uri, margin + 5, y + lineHeight / 2, { url: url.uri });
        doc.setTextColor(0, 0, 0); // Reset color
        y += lineHeight * 2;
      });
      y += sectionSpacing;
    }

    doc.save('GreenChoice_Report.pdf');
  };

  const isFormValid = productInput.trim() !== '' || imageFile !== null;

  const ToggleButton: React.FC<{
    isOpen: boolean;
    setOpen: (open: boolean) => void;
    label: string;
  }> = ({ isOpen, setOpen, label }) => (
    <button
      onClick={() => setOpen(!isOpen)}
      className="w-full py-2 px-4 bg-[#F7FFFB] text-[#0B3D2E] font-semibold rounded-lg
                 hover:bg-[#E9FBF3] transition-colors flex items-center justify-between mt-4"
      aria-expanded={isOpen}
      aria-controls={`section-${label.replace(/\s+/g, '-')}`}
    >
      <span className="text-sm sm:text-base">{label}</span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        className={`w-5 h-5 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
    </button>
  );

  return (
    <div className="flex flex-col items-center w-full min-h-screen relative bg-zinc-50 pb-20">
      {/* Header / Branding Section */}
      <header className="w-full text-center py-10 bg-[#7EE7C0] shadow-sm mb-12 relative overflow-hidden rounded-b-3xl">
        {/* Animated Gradient Layer */}
        <div className="absolute inset-0 bg-animated-gradient animate-gradient-shift"></div>
        {/* Wave SVG */}
        <div className="absolute bottom-0 left-0 w-full overflow-hidden leading-0">
          <svg className="relative block w-full h-16 text-zinc-50" viewBox="0 0 1440 100" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0,0C0,0,288,40,720,40C1152,40,1440,0,1440,0L1440,100L0,100L0,0Z" fill="currentColor"></path>
          </svg>
        </div>
        <div className="relative z-10 flex flex-col items-center max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center gap-3 mb-2 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
            {/* Logo */}
            <div className="p-2 bg-[#0F6F57] rounded-full flex items-center justify-center shadow-md
                        transform transition-transform duration-200 hover:scale-110 hover:opacity-90 cursor-pointer" aria-label="GreenChoice logo">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-white">
                {/* Custom Stylized Tree Logo for GreenChoice */}
                <path d="M12.000,2.000C8.686,2.000,6.000,4.686,6.000,8.000C6.000,10.500,7.500,12.500,9.500,14.000C9.500,14.000,8.500,14.000,8.500,14.000C7.673,14.000,7.000,14.673,7.000,15.500C7.000,16.327,7.673,17.000,8.500,17.000C8.500,17.000,10.000,17.000,10.000,17.000C10.000,17.000,10.000,19.000,10.000,19.000C10.000,19.827,10.673,20.500,11.500,20.500C12.327,20.500,13.000,19.827,13.000,19.000C13.000,19.000,13.000,17.000,13.000,17.000C13.000,17.000,14.500,17.000,14.500,17.000C15.327,17.000,16.000,16.327,16.000,15.500C16.000,14.673,15.327,14.000,14.500,14.000C14.500,14.000,12.500,12.500,14.500,14.000C16.000,12.500,17.500,10.500,17.500,8.000C17.500,4.686,14.814,2.000,12.000,2.000ZM12.000,4.000C13.789,4.000,15.250,5.461,15.250,7.250C15.250,8.375,14.687,9.375,13.750,10.000C13.750,10.000,13.250,9.500,13.250,9.500C13.250,9.500,13.250,7.750,13.250,7.750C13.250,6.923,12.577,6.250,11.750,6.250C10.923,6.250,10.250,6.923,10.250,7.750C10.250,7.750,10.250,9.500,10.250,9.500C10.250,9.500,9.750,10.000,9.750,10.000C8.813,9.375,8.250,8.375,8.250,7.250C8.250,5.461,9.711,4.000,11.500,4.000ZM12.000,6.500C12.827,6.500,13.500,5.827,13.500,5.000C13.500,4.173,12.827,3.500,12.000,3.500C11.173,3.500,10.500,4.173,10.500,5.000C10.500,5.827,11.173,6.500,12.000,6.500Z" />
              </svg>
            </div>
            {/* App Name */}
            <h1 className="text-5xl font-black tracking-tight">
              <span className="text-[#0F6F57]">Green</span>
              <span className="text-zinc-800">Choice</span>
            </h1>
          </div>
          <p className="text-lg text-[#0B3D2E] mt-2 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            Verify sustainability claims with clarity and confidence.
          </p>
          {/* New Trust Line */}
          <p className="text-md text-[#0B3D2E] font-medium mt-1 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
            Built for transparent, explainable sustainability checks.
          </p>
          {/* Downward Visual Cue */}
          <div className="mt-8 animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-[#0F6F57] animate-bounce" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </div>
      </header>

      {/* Main content wrapper */}
      <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 -mt-16 relative z-20">
        {/* Main Content Area - Centered Input Card */}
        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-lg w-full mb-10 animate-fade-in-up" style={{ animationDelay: '0.5s' }}>
          {/* Instruction Text */}
          <p className="text-sm text-zinc-600 mb-3">
            Paste the product’s ingredient list and sustainability claims
          </p>
          <textarea
            className="w-full p-4 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7EE7C0] text-gray-800 placeholder-gray-400 resize-y min-h-[120px] sm:min-h-[140px] bg-white"
            rows={6}
            placeholder="Ingredients: Water, Sugar, Citric Acid, Green Tea Extract
Claims: Eco-friendly, Biodegradable"
            value={productInput}
            onChange={handleTextChange}
            aria-label="Product ingredient list and sustainability claims"
          ></textarea>

          <div className="my-4 text-center text-zinc-500 text-sm font-medium relative">
            <span className="relative z-10 bg-white px-3">OR</span>
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-200"></div>
            </div>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageChange}
            className="hidden"
            accept="image/*"
            aria-label="Upload ingredient label image file input"
          />
          {!imageFile ? (
            <button
              onClick={handleImageUploadClick}
              className="w-full py-3 px-6 bg-white border border-[#0F6F57] text-[#0F6F57] rounded-lg hover:bg-[#E9FBF3] hover:border-[#0B3D2E] transition-colors font-semibold
                         flex items-center justify-center gap-2 text-base group relative" // Added relative for spinner positioning
              aria-label="Upload ingredient label image button"
              disabled={loading} // Disable upload button while loading
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[#0F6F57] group-hover:text-[#0B3D2E] transition-colors">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              Upload ingredient label image
              {loading && ( // Spinner for upload button when processing
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <svg className="animate-spin h-5 w-5 text-[#0F6F57]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              )}
            </button>
          ) : (
            <div className="mt-4 flex flex-col items-center">
              <div className="relative w-48 h-48 sm:w-64 sm:h-64 mb-4 rounded-lg overflow-hidden border-2 border-[#7EE7C0] shadow-md">
                <img
                  src={previewUrl!}
                  alt="Uploaded product label preview"
                  className="w-full h-full object-contain bg-zinc-100"
                />
                {loading && ( // Spinner over image preview when processing
                  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30">
                    <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex space-x-4">
                <button
                  onClick={handleRemoveImage}
                  className="py-2 px-4 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2 text-sm"
                  aria-label="Remove uploaded image"
                  disabled={loading} // Disable remove button while loading
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.927a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.166M9 6.75V5.25A2.25 2.25 0 0 1 11.25 3h1.5a2.25 2.25 0 0 1 2.25 2.25v1.5M12 9.75h.008v.008H12V9.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                  </svg>
                  Remove Image
                </button>
                <button
                  onClick={handleImageUploadClick}
                  className="py-2 px-4 bg-[#0F6F57] text-white rounded-lg hover:bg-[#0B3D2E] transition-colors flex items-center gap-2 text-sm"
                  aria-label="Change uploaded image"
                  disabled={loading} // Disable change button while loading
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  Change Image
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Primary Action Button */}
        <button
          onClick={handleSubmit}
          className="mt-10 py-4 px-8 bg-[#0F6F57] text-white font-bold rounded-full shadow-lg
                     hover:bg-[#0B3D2E] transition-colors focus:outline-none focus:ring-4 focus:ring-[#7EE7C0]
                     disabled:opacity-50 disabled:cursor-not-allowed text-lg sm:text-xl w-full max-w-sm mx-auto flex items-center justify-center animate-fade-in-up"
          style={{ animationDelay: '0.7s' }}
          disabled={!isFormValid || loading}
          aria-live="polite"
          aria-label="Check if this product is sustainable"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Analyzing...
            </span>
          ) : (
            'Check if this product is sustainable'
          )}
        </button>

        {/* Clear All Button */}
        <button
          onClick={handleClearAll}
          className="mt-4 py-3 px-8 bg-transparent border border-[#0F6F57] text-[#0F6F57] font-semibold rounded-full
                     hover:bg-[#E9FBF3] transition-colors focus:outline-none focus:ring-4 focus:ring-[#7EE7C0]
                     text-base sm:text-lg w-full max-w-sm mx-auto flex items-center justify-center animate-fade-in-up"
          style={{ animationDelay: '0.8s' }}
          aria-label="Clear all input fields and results"
          disabled={loading} // Disable clear all button while loading
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          Clear All
        </button>


        {/* How GreenChoice Works Section */}
        <section className="mt-16 animate-fade-in-up" style={{ animationDelay: '0.9s' }}>
          <h2 className="text-2xl font-bold text-center text-[#0B3D2E] mb-8">
            How GreenChoice Works
          </h2>
          <div className="flex flex-col sm:flex-row justify-center gap-y-8 sm:gap-x-8 lg:gap-x-12">
            <div className="flex flex-col items-center text-center max-w-[280px] w-full">
              <div className="p-3 bg-[#F7FFFB] rounded-full mb-3 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-[#0F6F57]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375H12a2.25 2.25 0 0 1-2.25-2.25V6A2.25 2.25 0 0 0 7.5 3.75H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.75M16.5 6V4.5a2.25 2.25 0 0 0-2.25-2.25H12A2.25 2.25 0 0 0 9.75 4.5V6M12 18.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM16.5 12h.008v.008H16.5v-.008Z" />
                </svg>
              </div>
              <h3 className="font-semibold text-[#0F6F57] mb-1">1. Scan or Paste</h3>
              <p className="text-sm text-[#4F6F66]">Paste ingredients or upload a label image.</p>
            </div>
            <div className="flex flex-col items-center text-center max-w-[280px] w-full">
              <div className="p-3 bg-[#F7FFFB] rounded-full mb-3 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-[#0F6F57]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              </div>
              <h3 className="font-semibold text-[#0F6F57] mb-1">2. Analyze Claims</h3>
              <p className="text-sm text-[#4F6F66]">AI checks claims against ingredient properties.</p>
            </div>
            <div className="flex flex-col items-center text-center max-w-[280px] w-full">
              <div className="p-3 bg-[#F7FFFB] rounded-full mb-3 shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-[#0F6F57]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </div>
              <h3 className="font-semibold text-[#0F6F57] mb-1">3. Get Clear Verdict</h3>
              <p className="text-sm text-[#4F6F66]">Receive an explainable sustainability verdict.</p>
            </div>
          </div>
        </section>

        {/* Irrelevant Input Message Display */}
        {irrelevantInputMessage && (
          <div className="mt-10 p-6 bg-yellow-50 border border-yellow-200 rounded-lg shadow-md w-full max-w-2xl mx-auto animate-fade-in-up text-center">
            <h2 className="text-xl font-bold text-yellow-800 mb-3 flex items-center justify-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-yellow-700">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.752zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              Input Not Recognized
            </h2>
            <p className="text-yellow-700 whitespace-pre-line leading-relaxed text-sm sm:text-base">
              {irrelevantInputMessage}
            </p>
          </div>
        )}

        {/* Real Example Preview */}
        {parsedResult && !irrelevantInputMessage && (
          <div ref={resultsRef} className="mt-10 p-6 bg-[#F7FFFB] border border-[#7EE7C0] rounded-lg shadow-md w-full max-w-2xl mx-auto animate-fade-in-up" style={{ animationDelay: '1.2s' }}>
            <h2 className="text-xl font-bold text-[#0B3D2E] mb-3 flex items-center gap-2">
              {parsedResult.icon} Sustainability Check Result
            </h2>

            <div className="text-gray-700 text-sm sm:text-base space-y-2">
              <p>
                <span className="font-semibold">Overall Verdict:</span> {parsedResult.overallVerdict}
              </p>
              <p>
                <span className="font-semibold">Greenwashing Risk:</span> {parsedResult.greenwashingRisk}
              </p>

              <div className="mt-4">
                <p className="font-semibold mb-1">Claims that failed to meet expectations:</p>
                {parsedResult.claimsFailed.length > 0 ? (
                  <ul className="list-disc list-inside space-y-0.5 ml-2">
                    {parsedResult.claimsFailed.map((claim, index) => (
                      <li key={`claim-${index}`}>{claim}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="ml-2">None</p>
                )}
              </div>

              <div className="mt-4">
                <p className="font-semibold mb-1">Why these claims failed:</p>
                {parsedResult.whyClaimsFailed.length > 0 ? (
                  <ul className="list-disc list-inside space-y-0.5 ml-2">
                    {parsedResult.whyClaimsFailed.map((reason, index) => (
                      <li key={`reason-${index}`}>{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="ml-2">All claims appear reasonable or are well-supported by ingredients.</p>
                )}
              </div>

              <div className="mt-4">
                <p className="font-semibold mb-1">Ingredients to note:</p>
                {parsedResult.ingredientsToNote.length > 0 ? (
                  <ul className="list-disc list-inside space-y-0.5 ml-2">
                    {parsedResult.ingredientsToNote.map((ingredient, index) => (
                      <li key={`ingredient-${index}`}>{ingredient}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="ml-2">None</p>
                )}
              </div>

              {/* Toggleable More details section */}
              {parsedResult.moreDetails && (
                <>
                  <ToggleButton
                    isOpen={showMoreDetails}
                    setOpen={setShowMoreDetails}
                    label="View more details"
                  />
                  {showMoreDetails && (
                    <div id="section-More-details" className="bg-[#E9FBF3] p-3 rounded-md mt-2 text-[#0B3D2E] text-sm leading-relaxed animate-fade-in-up">
                      {parsedResult.moreDetails}
                    </div>
                  )}
                </>
              )}

              {/* Toggleable Ingredient-specific details section */}
              {parsedResult.ingredientSpecificDetails && parsedResult.ingredientSpecificDetails.length > 0 && (
                <>
                  <ToggleButton
                    isOpen={showIngredientSpecificDetails}
                    setOpen={setShowIngredientSpecificDetails}
                    label="View ingredient-specific details"
                  />
                  {showIngredientSpecificDetails && (
                    <div id="section-Ingredient-specific-details" className="bg-[#E9FBF3] p-3 rounded-md mt-2 text-[#0B3D2E] text-sm leading-relaxed animate-fade-in-up">
                      {parsedResult.ingredientSpecificDetails.map((item, index) => (
                        <div key={`ing-spec-detail-${index}`} className="mb-2 last:mb-0">
                          <p className="font-semibold">{item.name}:</p>
                          <p className="ml-2">{item.explanation}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Toggleable Improvement suggestions section */}
              {parsedResult.improvementSuggestions && parsedResult.improvementSuggestions.length > 0 && (
                <>
                  <ToggleButton
                    isOpen={showImprovementSuggestions}
                    setOpen={setShowImprovementSuggestions}
                    label="View improvement suggestions"
                  />
                  {showImprovementSuggestions && (
                    <div id="section-Improvement-suggestions" className="bg-[#E9FBF3] p-3 rounded-md mt-2 text-[#0B3D2E] text-sm leading-relaxed animate-fade-in-up">
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        {parsedResult.improvementSuggestions.map((suggestion, index) => (
                          <li key={`suggestion-${index}`}>{suggestion}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {/* New: Toggleable Grounding URLs section */}
              {parsedResult.groundingUrls && parsedResult.groundingUrls.length > 0 && (
                <>
                  <ToggleButton
                    isOpen={showGroundingUrls}
                    setOpen={setShowGroundingUrls}
                    label="View Source Information"
                  />
                  {showGroundingUrls && (
                    <div id="section-Source-Information" className="bg-[#E9FBF3] p-3 rounded-md mt-2 text-[#0B3D2E] text-sm leading-relaxed animate-fade-in-up">
                      <p className="font-semibold mb-1">Sources used for this analysis:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        {parsedResult.groundingUrls.map((url, index) => (
                          <li key={`grounding-url-${index}`}>
                            <a href={url.uri} target="_blank" rel="noopener noreferrer" className="text-[#0F6F57] hover:underline">
                              {url.title || url.uri}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {/* Download PDF Button */}
              <button
                onClick={generatePdfReport}
                className="w-full py-3 px-6 bg-[#0F6F57] text-white font-semibold rounded-lg
                           hover:bg-[#0B3D2E] transition-colors flex items-center justify-center gap-2 mt-6"
                disabled={loading || !parsedResult}
                aria-label="Download sustainability check result as PDF report"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download PDF Report
              </button>

            </div>
          </div>
        )}

        {/* Fixed Example Preview Card */}
        <section className="mt-16 animate-fade-in-up" style={{ animationDelay: '1.2s' }}>
          <h2 className="text-2xl font-bold text-center text-[#0B3D2E] mb-8">
            Example Insight
          </h2>
          <div className="bg-[#F7FFFB] p-6 rounded-lg shadow-sm w-full max-w-xl mx-auto border border-[#7EE7C0]">
            <div className="bg-white p-4 rounded-md shadow-inner text-sm">
              <p className="font-semibold mb-1 text-[#0B3D2E]">Claim 'Biodegradable' flagged due to:</p>
              <ul className="list-disc list-inside text-[#4F6F66]">
                <li>Presence of polyethylene (a non-biodegradable plastic) in ingredient list.</li>
                <li>Lack of specific certification or standard cited for biodegradability claim.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Footer / Personas Section */}
        <section className="mt-20 w-full px-4 sm:px-6 lg:px-8 animate-fade-in-up" style={{ animationDelay: '1.5s' }}>
          <h2 className="text-2xl font-bold text-center text-[#0B3D2E] mb-8">
            Who is GreenChoice for?
          </h2>
          <div className="flex flex-wrap justify-center gap-8 md:gap-x-12">
            {/* Persona Card 1: Conscious Consumer */}
            <div className="bg-[#F7FFFB] p-5 rounded-lg shadow-sm flex flex-col items-center text-center max-w-[200px] w-full border border-[#7EE7C0]
                          transform transition-all duration-300 hover:scale-105 hover:shadow-lg group">
              <div className="p-3 bg-[#E9FBF3] rounded-full mb-3
                            transform transition-transform duration-300 group-hover:scale-110">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-[#0F6F57] group-hover:text-[#0B3D2E] transition-colors">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                </svg>
              </div>
              <h3 className="font-semibold text-[#0F6F57] mb-1">Conscious Consumer</h3>
              <p className="text-sm text-[#4F6F66]">Helps everyday shoppers avoid misleading eco-claims.</p>
            </div>

            {/* Persona Card 2: Sustainability Student */}
            <div className="bg-[#F7FFFB] p-5 rounded-lg shadow-sm flex flex-col items-center text-center max-w-[200px] w-full border border-[#7EE7C0]
                          transform transition-all duration-300 hover:scale-105 hover:shadow-lg group">
              <div className="p-3 bg-[#E9FBF3] rounded-full mb-3
                            transform transition-transform duration-300 group-hover:scale-110">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-[#0F6F57] group-hover:text-[#0B3D2E] transition-colors">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.105 11.666 2.6c.207-.208.487-.306.77-.297 1.838.033 2.518-.088 2.651-.107.283-.016.563.082.771.29L19.74 10.105c.222.223.332.514.332.812A.996.996 0 0 1 19.01 11.75l-7.258 7.258a1.5 1.5 0 0 1-2.122 0L3.99 11.75a.996.996 0 0 1-.005-.833c0-.298.11-.589.332-.812Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.25 10.5 1.5 1.5.75-.75" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5l-1.5 1.5-.75-.75M12 4.5l1.5 1.5.75-.75" />
                </svg>
              </div>
              <h3 className="font-semibold text-[#0F6F57] mb-1">Sustainability Student</h3>
              <p className="text-sm text-[#4F6F66]">Supports learning and research on greenwashing.</p>
            </div>

            {/* Persona Card 3: NGO / Advocate */}
            <div className="bg-[#F7FFFB] p-5 rounded-lg shadow-sm flex flex-col items-center text-center max-w-[200px] w-full border border-[#7EE7C0]
                          transform transition-all duration-300 hover:scale-105 hover:shadow-lg group">
              <div className="p-3 bg-[#E9FBF3] rounded-full mb-3
                            transform transition-transform duration-300 group-hover:scale-110">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-[#0F6F57] group-hover:text-[#0B3D2E] transition-colors">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21v-4.5m0 0V5.691m0 10.809a3.75 3.75 0 0 1-3.75-3.75M12 16.809a3.75 3.75 0 0 0 3.75-3.75m-4.5 0H9M12 12.809V1.5m0 0l-3 3m3-3 3 3" />
                </svg>
              </div>
              <h3 className="font-semibold text-[#0F6F57] mb-1">NGO / Advocate</h3>
              <p className="text-sm text-[#4F6F66]">Assists environmental organizations in awareness building.</p>
            </div>

            {/* Persona Card 4: Product Reviewer (Optional) */}
            <div className="bg-[#F7FFFB] p-5 rounded-lg shadow-sm flex flex-col items-center text-center max-w-[200px] w-full border border-[#7EE7C0]
                          transform transition-all duration-300 hover:scale-105 hover:shadow-lg group">
              <div className="p-3 bg-[#E9FBF3] rounded-full mb-3
                            transform transition-transform duration-300 group-hover:scale-110">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-[#0F6F57] group-hover:text-[#0B3D2E] transition-colors">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                </svg>
              </div>
              <h3 className="font-semibold text-[#0F6F57] mb-1">Product Reviewer</h3>
              <p className="text-sm text-[#4F6F66]">Enables ethical product comparisons and reviews.</p>
            </div>
          </div>
        </section>
      </main>

      {/* Error Display */}
      {error && (
        <div className="mt-10 p-6 bg-red-100 border border-red-300 rounded-lg shadow-md w-full max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-red-700 mb-3">Error:</h2>
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Trust & Ethics Footer */}
      <footer className="w-full bg-emerald-950 text-emerald-50 pt-12 relative overflow-hidden shadow-2xl shadow-emerald-950/60 mt-20">
        {/* Subtle Leaf Watermark */}
        <svg
          className="absolute inset-0 w-full h-full opacity-[0.05] scale-175 pointer-events-none" // Even lower opacity, scaled larger
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M12.000,2.000C8.686,2.000,6.000,4.686,6.000,8.000C6.000,10.500,7.500,12.500,9.500,14.000C9.500,14.000,8.500,14.000,8.500,14.000C7.673,14.000,7.000,14.673,7.000,15.500C7.000,16.327,7.673,17.000,8.500,17.000C8.500,17.000,10.000,17.000,10.000,17.000C10.000,17.000,10.000,19.000,10.000,19.000C10.000,19.827,10.673,20.500,11.500,20.500C12.327,20.500,13.000,19.827,13.000,19.000C13.000,19.000,13.000,17.000,13.000,17.000C13.000,17.000,14.500,17.000,14.500,17.000C15.327,17.000,16.000,16.327,16.000,15.500C16.000,14.673,15.327,14.000,14.500,14.000C14.500,14.000,12.500,12.500,14.500,14.000C16.000,12.500,17.500,10.500,17.500,8.000C17.500,4.686,14.814,2.000,12.000,2.000ZM12.000,4.000C13.789,4.000,15.250,5.461,15.250,7.250C15.250,8.375,14.687,9.375,13.750,10.000C13.750,10.000,13.250,9.500,13.250,9.500C13.250,9.500,13.250,7.750,13.250,7.750C13.250,6.923,12.577,6.250,11.750,6.250C10.923,6.250,10.250,6.923,10.250,7.750C10.250,7.750,10.250,9.500,10.250,9.500C10.250,9.500,9.750,10.000,9.750,10.000C8.813,9.375,8.250,8.375,8.250,7.250C8.250,5.461,9.711,4.000,11.500,4.000ZM12.000,6.500C12.827,6.500,13.500,5.827,13.500,5.000C13.500,4.173,12.827,3.500,12.000,3.500C11.173,3.500,10.500,4.173,10.500,5.000C10.500,5.827,11.173,6.500,12.000,6.500Z" />
        </svg>

        <div className="relative z-10 flex flex-col items-center">
          {/* New Footer Heading */}
          <h3 className="text-sm font-semibold uppercase text-[#B1F8D9] mb-8 tracking-wide">
            Built with transparency and responsibility
          </h3>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-y-6 sm:gap-x-12 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
            {/* Column 1: Explainable AI */}
            <div className="flex items-center text-center py-2 px-4 sm:border-r border-[#0B3D2E] sm:last:border-r-0">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[#7EE7C0] mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.008v.008H12V18Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM12 12.75h.008v.008H12V12.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM12 6.75h.008v.008H12V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3 4.5h1.684a2.25 2.25 0 0 0 2.15-1.586L6.8 1.98c.243-.984 1.162-1.663 2.21-1.663h1.305c.532 0 1.05.18 1.455.513l.29.289c.407.408.847.697 1.353.861L18 3c1.037.16 1.957.545 2.757 1.154l.267.203a1.5 1.5 0 0 0 .564 1.252l.623.704A1.5 1.5 0 0 1 22.5 8.25v2.25c0 .193-.026.38-.076.56L22.1 13c-.227 1.285-.905 2.372-1.925 3.097L18.75 17c-.322.228-.667.368-1.026.417L15 17.625h-.124c-.604 0-1.18-.198-1.643-.544L12 16.5l-1.233.916c-.463.346-1.039.544-1.643.544H9L6.175 17.417c-.359-.049-.704-.189-1.026-.417L3.925 16.097C2.905 15.372 2.227 14.285 2 13l-.401-1.22c-.05-.18-.076-.367-.076-.56V8.25c0-.505.21-.97.564-1.252l.623-.704a1.5 1.5 0 0 1 .564-1.252L6 4.654A9.957 9.957 0 0 1 12 3Z" />
              </svg>
              <p className="text-sm font-medium text-[#B1F8D9]">Explainable AI decisions</p>
            </div>

            {/* Column 2: Ethical & Responsible */}
            <div className="flex items-center text-center py-2 px-4 sm:border-r border-[#0B3D2E] sm:last:border-r-0">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[#7EE7C0] mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.125 3.75c-.625 0-1.125.504-1.125 1.125v3.026a2.99 2.99 0 0 1-.841 2.07l-1.97 1.97a.992.992 0 0 0-.292.684v1.086c0 .167.07.329.198.441l.952.833-.952.833a.992.992 0 0 0-.198.441v1.086c0 .265.105.52.292.707l1.97 1.97c.361.361.83.585 1.317.658.056.008.112-.002.168-.002h5.625c.056 0 .112.01.168.002.486-.073.955-.297 1.316-.658l1.97-1.97c.187-.187.292-.442.292-.707v-1.086c0-.265-.105-.52-.292-.707l-1.97-1.97a2.99 2.99 0 0 1-.84-2.07V4.875c0-.621-.504-1.125-1.125-1.125H10.125Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6.75h-7.5" />
              </svg>
              <p className="text-sm font-medium text-[#B1F8D9]">No legal or certification claims</p>
            </div>

            {/* Column 3: Privacy First */}
            <div className="flex items-center text-center py-2 px-4">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[#7EE7C0] mr-2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
              <p className="text-sm font-medium text-[#B1F8D9]">No personal data stored</p>
            </div>
          </div>

          {/* Footer Closure */}
          <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-8"> {/* Adjusted mt-10 to mt-8 for tighter spacing */}
            <hr className="border-t border-[#0B3D2E] mb-4" /> {/* Darker border for subtle contrast, adjusted mb */}
            <p className="text-xs text-[#B1F8D9] flex items-center justify-center gap-1.5 pb-6"> {/* Muted text and centered with leaf icon, smaller font */}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-[#B1F8D9]"> {/* Smaller icon */}
                <path d="M12.000,2.000C8.686,2.000,6.000,4.686,6.000,8.000C6.000,10.500,7.500,12.500,9.500,14.000C9.500,14.000,8.500,14.000,8.500,14.000C7.673,14.000,7.000,14.673,7.000,15.500C7.000,16.327,7.673,17.000,8.500,17.000C8.500,17.000,10.000,17.000,10.000,17.000C10.000,17.000,10.000,19.000,10.000,19.000C10.000,19.827,10.673,20.500,11.500,20.500C12.327,20.500,13.000,19.827,13.000,19.000C13.000,19.000,13.000,17.000,13.000,17.000C13.000,17.000,14.500,17.000,14.500,17.000C15.327,17.000,16.000,16.327,16.000,15.500C16.000,14.673,15.327,14.000,14.500,14.000C14.500,14.000,12.500,12.500,14.500,14.000C16.000,12.500,17.500,10.500,17.500,8.000C17.500,4.686,14.814,2.000,12.000,2.000ZM12.000,4.000C13.789,4.000,15.250,5.461,15.250,7.250C15.250,8.375,14.687,9.375,13.750,10.000C13.750,10.000,13.250,9.500,13.250,9.500C13.250,9.500,13.250,7.750,13.250,7.750C13.250,6.923,12.577,6.250,11.750,6.250C10.923,6.250,10.250,6.923,10.250,7.750C10.250,7.750,10.250,9.500,10.250,9.500C10.250,9.500,9.750,10.000,9.750,10.000C8.813,9.375,8.250,8.375,8.250,7.250C8.250,5.461,9.711,4.000,11.500,4.000ZM12.000,6.500C12.827,6.500,13.500,5.827,13.500,5.000C13.500,4.173,12.827,3.500,12.000,3.500C11.173,3.500,10.500,4.173,10.500,5.000C10.500,5.827,11.173,6.500,12.000,6.500Z" />
              </svg>
              <span>GreenChoice — helping consumers make informed, sustainable decisions.</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;