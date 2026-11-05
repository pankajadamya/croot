import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import { AuthProvider } from './lib/auth'
import { ConfirmProvider } from './components/ConfirmDialog'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, err) => count < 2 && !(err as { status?: number }).status, refetchOnWindowFocus: false },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ConfirmProvider>
            <App />
          </ConfirmProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
