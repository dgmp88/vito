import { create } from 'zustand'

interface DocumentStore {
  document: string
  updateDocument: (content: string) => void
  clearDocument: () => void
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  document: '',
  updateDocument: (content) => set({ document: content }),
  clearDocument: () => set({ document: '' }),
}))

// Export actions for use outside React components (e.g., in tool calls)
export const documentActions = {
  updateDocument: (content: string) => useDocumentStore.getState().updateDocument(content),
  clearDocument: () => useDocumentStore.getState().clearDocument(),
  getDocument: () => useDocumentStore.getState().document,
}