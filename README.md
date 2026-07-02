# GarageFlow — Sales Engine 🤖

Máquina comercial autónoma com IA para o **GarageFlow** (CRM/gestão para oficinas automóveis).
Encontra oficinas, analisa, qualifica, escreve mensagens personalizadas, faz follow-ups, responde,
marca demos e envia relatórios diários — **100% na cloud**, sem depender do teu computador ligado.

> Stack: **Node.js + TypeScript**, **Supabase** (Postgres), **Google Places API**, **OpenAI**,
> **Resend** (email), **Calendly** (demos), corre no **Railway** (worker + cron + webhooks).

---

## 🧠 Os 8 agentes

| Agente | O que faz |
|---|---|
| **Prospect** | Faz scrape de **todas** as oficinas de uma vez (todas as cidades × keywords), pagina o Google Places por completo, deduplica e grava. |
| **Research** | Lê o website e dados de cada oficina e escreve *"porque beneficia do GarageFlow"*. |
| **Qualification** | Dá score 0–100 com justificação (tamanho, atividade, presença digital, potencial). |
| **Sales** | Escreve o email de 1.º contacto **personalizado** por oficina (nunca genérico). |
| **Follow-up** | Sequência automática D0 → D3 → D7 → D14. Pára sozinha quando há resposta. |
| **Reply** | Analisa a intenção da resposta, responde, e encaminha interessados para demo. |
| **Meeting** | Envia link Calendly e regista a reunião via webhook. |
| **Analytics** | Métricas diárias + recomendações, com relatório por email. |

---

## 🚀 Deploy em 6 passos

### 1. Supabase (base de dados)
1. Cria projeto em [supabase.com](https://supabase.com) (plano free chega para começar).
2. **SQL Editor → New query** → cola o conteúdo de `supabase/migrations/0001_init.sql` → **Run**.
3. Copia de **Project Settings → API**: `Project URL` e a **`service_role`** key (secreta, backend).

### 2. Google Places API
1. [console.cloud.google.com](https://console.cloud.google.com) → cria projeto → ativa **Places API (New)**.
2. Cria uma **API Key**. Ativa faturação (tens ~200 USD/mês de crédito grátis).
3. Guarda a key para `GOOGLE_PLACES_API_KEY`.

### 3. OpenAI
Cria uma API key em [platform.openai.com](https://platform.openai.com). Modelo default: `gpt-4o-mini` (barato).

### 4. Resend (email)
1. [resend.com](https://resend.com) → adiciona e **verifica o teu domínio** (SPF/DKIM). ⚠️ Essencial para deliverability.
2. Cria API key → `RESEND_API_KEY`. Define `EMAIL_FROM` com o teu domínio verificado.

### 5. GitHub
```bash
cd garageflow-sales-engine
git init
git add .
git commit -m "GarageFlow Sales Engine"
git branch -M main
git remote add origin https://github.com/<o-teu-user>/garageflow-sales-engine.git
git push -u origin main
```

### 6. Railway
1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → escolhe o repo.
2. **Variables** → cola todas as variáveis do `.env.example` com os teus valores reais.
   - Começa com `DRY_RUN=true` (não envia emails, só grava rascunhos — para testares em segurança).
3. Railway faz build (`npm run build`) e arranca (`npm start`) automaticamente.
4. Em **Settings → Networking → Generate Domain** ficas com o URL do dashboard e dos webhooks.

**Webhooks a configurar depois do deploy:**
- Calendly → `https://<o-teu-app>.up.railway.app/webhooks/calendly`
- Email inbound (respostas) → `https://<o-teu-app>.up.railway.app/webhooks/email-inbound`

---

## ▶️ Como usar

O worker no Railway corre sozinho:
- **Pipeline diário** às 08:00 (`PIPELINE_CRON`) — analisa, qualifica, escreve, envia, reporta.
- **Prospecção** 1×/semana (segunda 06:00) — renova o funil com novas oficinas.

Correr manualmente (local ou via endpoint):
```bash
npm install
cp .env.example .env      # preenche os valores
npm run prospect          # scrape de TODAS as oficinas agora
npm run pipeline          # corre o pipeline completo uma vez
npm run report            # gera e envia o relatório diário
npm run dev               # worker em modo watch (local)
```

Ou por HTTP (com `TRIGGER_TOKEN` definido nas variáveis):
```
POST /run/prospect?token=XXX        # só prospecção
POST /run/pipeline?token=XXX        # pipeline sem prospecção
POST /run/pipeline-full?token=XXX   # pipeline + prospecção
```

**Dashboard:** abre o URL raiz do teu app Railway (`/`).

---

## 🔒 RGPD / anti-spam (lê isto)

Estás a fazer cold outreach B2B na UE. O sistema já traz salvaguardas, mas a responsabilidade é tua:

- **Base legal:** interesse legítimo B2B, a contactar oficinas via contactos comerciais públicos.
- **Opt-out sempre:** cada email inclui a instrução de resposta "remover"; o Reply Agent deteta e **suprime** automaticamente (tabela `supressoes`) — nunca mais é contactada.
- **Warm-up:** mantém `DAILY_SEND_LIMIT` baixo (30–50) nas primeiras semanas e sobe devagar.
- **Domínio verificado** (SPF/DKIM/DMARC) no Resend, de preferência um domínio secundário para outreach.
- **`DRY_RUN=true`** até teres tudo verificado — testa o funil sem enviar nada real.
- Ajusta `MIN_SCORE_TO_CONTACT` para só contactar leads com bom encaixe.

---

## 🗂️ Estrutura

```
garageflow-sales-engine/
├── supabase/migrations/0001_init.sql   # schema completo
├── src/
│   ├── config.ts        # variáveis de ambiente
│   ├── db.ts            # cliente Supabase + logs + estado dos agentes
│   ├── llm.ts           # wrapper OpenAI (texto e JSON)
│   ├── pipeline.ts      # orquestrador
│   ├── index.ts         # CLI + scheduler (cron)
│   ├── server.ts        # dashboard + webhooks + triggers
│   ├── agents/          # os 8 agentes
│   └── integrations/    # places, email (Resend), calendly, emailFinder
├── railway.json / nixpacks.toml
├── .env.example
└── README.md
```

## 💸 Custo estimado (arranque solo)
Supabase free · Railway ~5 USD/mês · Google Places dentro do crédito grátis · OpenAI ~poucos €/1000 leads (gpt-4o-mini) · Resend free até 3.000 emails/mês. **Começas por menos de 10 €/mês.**

---

## 🔜 Próximos upgrades (vantagem competitiva)
- Canal **WhatsApp** (Twilio/Meta) além do email — as oficinas respondem muito mais por WhatsApp.
- A/B testing automático de assuntos/mensagens no Analytics Agent.
- Enriquecimento com scraping de redes sociais e horários.
- Lead scoring com feedback loop (o que converteu → re-treina os critérios).
