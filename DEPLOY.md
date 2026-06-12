# Degradoland online

Questa versione include un server Node con WebSocket. Il server serve la build React, mantiene una lobby realtime da 14 personaggi e gestisce la chat di gruppo.

## Prova locale

```bash
npm run build
npm start
```

Apri `http://localhost:3000` in due schede diverse per vedere i personaggi occupati aggiornarsi in tempo reale.

## Deploy rapido su Render

1. Crea un repository GitHub con questo progetto.
2. Su Render crea un nuovo **Web Service** collegato al repo.
3. Imposta:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
4. Pubblica il servizio e condividi l'URL con gli amici.

Render imposta automaticamente la variabile `PORT`, quindi il server usera la porta corretta.

## Nota sulla lobby

La lobby condivisa e la chat vivono in memoria sul server. Va bene per giocare con gli amici, ma se il server si riavvia si resettano.
