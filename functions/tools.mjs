function parseDescription(fnString) {
  const match = fnString.match(/'##([\s\S]*?)##'/);
  if (match) {
    return match[1].trim();
  }

  return "";
}

// parse the parameters from the function string representation and extract the type from an inline comment, e.g. /*string*/ paramName
// returns an array with { name: string, type: string, } objects
function parseParameters(fnString) {
  const match = fnString.match(/\(([\s\S]*?)\)/);
  if (match) {
    const params = match[1].split(",").map((param) => param.trim());
    return params.map((param) => {
      const typeMatch = param.match(/\/\*(.*?)\*\//);
      const nameMatch = param.match(/([a-zA-Z0-9_]+)/);
      return {
        name: nameMatch ? nameMatch[1] : "",
        type: typeMatch ? typeMatch[1] : "string",
      };
    });
  }

  return [];
}

// list of tools in a format used by AI function calls
export const getTools = (functions) =>
  Object.entries(functions).map(([name, fn]) => {
    return {
      type: "function",
      function: {
        name: name,
        description: parseDescription(fn.toString()),
        parameters: {
          type: "object",
          properties: {
            ...parseParameters(fn.toString()).reduce((acc, param) => {
              acc[param.name] = { type: param.type };
              return acc;
            }, {}),
          },
        },
      },
    };
  });
