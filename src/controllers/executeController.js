import executeCode from '../utils/executeCode.js';

// Updated controller with proper error handling
export const codeExecute = async (req, res, next) => {
  try {
    // Destructure language and code from request body
    const { language, code } = req.body;

    // Validate input
    if (!language) {
      return res.status(400).json({ 
        success: false, 
        error: 'Language is required' 
      });
    }

    if (!code) {
      return res.status(400).json({ 
        success: false, 
        error: 'Code is required' 
      });
    }

    // Execute code
    const output = await executeCode(language, code);

    // Send successful response
    res.json({ 
      success: true, 
      output 
    });

  } catch (error) {
    // Log the error for debugging
    console.error('Code execution error:', error);

    // Send error response
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Execution failed' 
    });
  }
};
