import 'dotenv/config'; 
import { FunctionTool, LlmAgent } from '@google/adk';
import { z } from 'zod';

/* 1. Define the Tool */
const getCurrentTime = new FunctionTool({
  name: 'get_current_time',
  description: 'Returns the current time in a specified city.',
  parameters: z.object({
    city: z.string().describe("The name of the city for which to retrieve the current time."),
  }),
  execute: async ({ city }) => {
    // You can replace this with a real API call later!
    return { status: 'success', report: `The current time in ${city} is 10:30 AM` };
  },
});

/* 2. Define and Export the Agent */
export const rootAgent = new LlmAgent({
  name: 'hello_time_agent',
  model: 'gemini-2.5-flash-lite', // Using the stable version
  description: 'An agent that tells the time.',
  instruction: `You are a helpful time assistant. 
                When asked for the time in a city, ALWAYS use the 'get_current_time' tool.`,
  tools: [getCurrentTime],
});
