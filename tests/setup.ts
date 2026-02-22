import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
console.log('[test setup] OPENAI_API_KEY loaded:', !!process.env.OPENAI_API_KEY)
