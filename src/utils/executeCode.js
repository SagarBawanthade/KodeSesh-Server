import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

// Utility function to execute code
const executeCode = (language, code) => {
  return new Promise((resolve, reject) => {
    // Create a temporary directory if it doesn't exist
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    let filename = '';
    let command = '';

    // Determine execution method based on language
    switch(language.toLowerCase()) {
      case 'python':
        filename = path.join(tempDir, `code_${Date.now()}.py`);
        fs.writeFileSync(filename, code);
        command = `python ${filename}`;
        break;
      
      case 'javascript':
        filename = path.join(tempDir, `code_${Date.now()}.js`);
        fs.writeFileSync(filename, code);
        command = `node ${filename}`;
        break;
      
      case 'java':
        filename = path.join(tempDir, `Code_${Date.now()}.java`);
        fs.writeFileSync(filename, code);
        // Compile and run Java code
        command = `javac ${filename} && java -cp ${tempDir} Code_${Date.now()}`;
        break;
      
      case 'cpp':
        filename = path.join(tempDir, `code_${Date.now()}.cpp`);
        fs.writeFileSync(filename, code);
        // Compile and run C++ code
        command = `g++ ${filename} -o ${filename}.out && ${filename}.out`;
        break;
      
      default:
        return reject(new Error(`Unsupported language: ${language}`));
    }

    // Execute the code
    exec(command, { 
      timeout: 10000,  // 10 seconds timeout
      cwd: tempDir
    }, (error, stdout, stderr) => {
      // Clean up temporary files
      try {
        if (fs.existsSync(filename)) {
          fs.unlinkSync(filename);
        }
        // Remove compiled files for Java and C++
        if (language.toLowerCase() === 'java') {
          const classFile = filename.replace('.java', '.class');
          if (fs.existsSync(classFile)) {
            fs.unlinkSync(classFile);
          }
        }
        if (language.toLowerCase() === 'cpp') {
          const outFile = filename + '.out';
          if (fs.existsSync(outFile)) {
            fs.unlinkSync(outFile);
          }
        }
      } catch (cleanupError) {
        console.error('Error cleaning up files:', cleanupError);
      }

      // Handle execution results
      if (error) {
        return reject(new Error(stderr || error.message));
      }

      resolve(stdout.trim());
    });
  });
};

// Controller for code execution
export const codeExecute = async (req, res) => {
  try {
    const { language, code } = req.body;

    // Validate input
    if (!language || !code) {
      return res.status(400).json({
        success: false,
        error: 'Language and code are required'
      });
    }

    // Execute code
    const output = await executeCode(language, code);

    // Respond with successful execution
    res.json({ 
      success: true, 
      output 
    });

  } catch (error) {
    // Handle any errors during execution
    console.error('Code execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Export for router use
export default codeExecute;