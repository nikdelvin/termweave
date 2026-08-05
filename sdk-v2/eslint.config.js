import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/.generated/**',
      'src-tauri/binaries/**',
      'src-tauri/gen/**',
      'src-tauri/target/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'app/**/*.{ts,tsx}',
      'src/**/*.{ts,tsx}',
      'scripts/**/*.ts',
      'shared/**/*.ts',
      'tests/**/*.{ts,tsx}',
      'vite.config.ts',
    ],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-undef': 'off',
    },
  },
)
