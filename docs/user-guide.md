# Goman — user guide

Goman is a prediction market. You buy shares in an outcome of a real-world question, and the
price of a share is the market's estimate of how likely that outcome is. If you are right, each
winning share pays out; if you are wrong, it is worth nothing.

Every market lives on the Nurachain blockchain. Goman is the interface to it — it never holds
your money, and it cannot move it. Nothing here is financial advice.

---

## 1. What you need

| | |
|---|---|
| **A wallet** | A browser wallet: Nura Wallet, MetaMask, Trust, Binance, Coinbase, Phantom or Rabby. Any wallet that announces itself to the page shows up in the connect sheet; the ones you do not have are offered as install links. |
| **The network** | Nurachain (chain ID `1020`), whose coin is **NURA**. In the footer, **Add to wallet** adds the network to your wallet in one click. |
| **Some NURA** | It is both what you trade with and what pays the network fee for each transaction. |

Your wallet **is** your account. There is no sign-up, no email and no password. Connecting only
reveals your address — every action that moves money is a separate transaction you approve
yourself.

---

## 2. Finding a market

- **Home** groups markets into *Featured*, *Trending*, *Ending soon* and *New*.
- **Browse** gives you search, a category filter, and sorting by volume, newest, or ending soon.
- The **bookmark** on any market adds it to your **watchlist**. The watchlist is stored in that
  browser only — it is not tied to your wallet and does not follow you to another device.

Each card shows the question, the chance of each outcome, the traded volume, and when the
market resolves.

---

## 3. Reading a market

**The price is the probability.** A share at 34¢ means the market thinks that outcome has a
34% chance. You can switch between the two spellings in *Settings → Odds format*.

**The Rules tab is the contract.** It says exactly what has to happen for the market to resolve
one way or the other, and which source decides it. Read it before you trade — a market resolves
on its rules, not on what the title suggests.

**Two kinds of market:**

- **Shares market** — you buy shares at a price that moves as people trade. A large order moves
  the price against you, which the ticket shows as *price impact*. Each winning share is
  redeemable for 1 NURA.
- **Pool market** — you place a bet into a pot. When the market resolves, everyone who backed
  the winning outcome splits the pot in proportion to what they put in.

**Status** is shown on the market:

| Status | What it means |
|---|---|
| Open | Trading normally. |
| Paused | Trading is temporarily stopped. |
| Closed | Trading has ended; the result is not in yet. |
| Resolved | The winning outcome is fixed and winnings can be claimed. |
| Voided | The market was cancelled; every outcome refunds equally. |

---

## 4. Placing a trade

1. Pick the outcome (on a Yes/No market, the side).
2. Enter the amount in NURA.
3. The ticket shows what you get: the number of shares, the payout if you are right, the price
   per share, and the fee plus price impact. This quote comes from the market's own on-chain
   maths, so it matches what the transaction will actually do.
4. Approve it in your wallet.
5. You will see *submitted*, then *confirmed*, then a short *syncing* moment before the trade
   appears in your portfolio and in the market's activity.

**You cannot sell a position back before the market resolves.** Once you have bought, you hold
until it settles.

**Fees.** Each market charges a trading fee, already included in the quote you see. On chain it
splits in two: part goes to whoever provided that market's liquidity, and part goes to the
protocol treasury. The treasury's part is what funds the referral programme.

---

## 5. When a market resolves

Nothing is credited automatically — you claim it.

1. Open **Portfolio**. Resolved markets where you hold winning shares appear under **Winnings**.
2. Press **Claim** and approve the transaction. Shares markets pay 1 NURA per winning share;
   pool markets pay your share of the pot.

A **voided** market is claimed the same way, and refunds every outcome equally.

---

## 6. Your portfolio

- **Balance** — the NURA in your connected wallet.
- **Positions value** — what your open positions are worth at current prices.
- **Profit / Loss** — value against what you paid.
- **Positions** — active and closed, searchable.
- **Activity** — every trade and claim, with a link to it on the block explorer.

---

## 7. Leaderboard

The top 25 traders by profit over the last day, week, month, or all time. Profit counts open
positions at their current price as well as settled ones, so a good position that has not
resolved yet still shows. It is built from on-chain trades, so everyone is in it — there is
nothing to opt into.

---

## 8. Referrals

Bring people to the market and earn a share of the trading fees they pay. No cap, no expiry.

**How it works**

1. Open **Referrals** and create a link. Give each channel its own named link, so you can see
   which one brings people who actually trade.
2. Your link looks like `https://<site>/?ref=YOURCODE`.
3. Someone who opens it sees who invited them and accepts with a signature. That binds their
   wallet to you permanently. A wallet can accept only one invitation, once.

**What you earn**

| Tier | Share of the protocol fee their trades pay |
|---|---|
| **Direct** — people who accepted your link | 75% |
| **Indirect** — people *they* referred | 25% |

Earnings are counted from fees that have already reached the treasury. They are settled from it
on chain — they are not a spendable balance inside the app.

---

## 9. Language and appearance

- **Ten languages**: English, فارسی, العربية, Español, Português, हिन्दी, 中文, Русский,
  Français, Türkçe. Persian and Arabic flip the whole layout right-to-left.
- Persian shows Persian digits, Persian scale words and the Jalali calendar. Every other
  language keeps Latin digits.
- **Dark and light** themes.
- **Odds format**: percentages (`34%`) or cents (`34¢`).

Market questions, rules and answers are written by their author in whichever of those languages
they speak, and stored that way on chain. If a market was never translated into your language,
you see its English text.

---

## 10. For admins

The admin console at `/admin` opens only for the wallet that holds the admin role on chain.

- **Create** a market: the question, description and answers in any of the ten languages
  (English is required, the rest are optional), an emoji or image, a category, the lock and
  resolve times, the trading fee, and the starting liquidity.
- **Discover** crawls Polymarket by topic and fills a new market's wording, answers and dates in
  for you.
- **Categories**: a category ID rides on chain with every market that carries it and can never
  be renamed. Its name, its order and whether it appears in pickers are presentation and can be
  edited or deleted at any time — deleting only removes the label, and the markets keep working.
- **Markets, Treasury, Factory and Activity** show live chain state, and resolve markets once
  their outcome is known.

---

## FAQ

**Do I need an account?**
No. Your wallet is the account. Connect it and you are in.

**Is connecting my wallet safe?**
Connecting only shares your address. Every trade, claim or referral acceptance is a separate
request you approve in your own wallet, and you can always decline.

**What is NURA?**
The native coin of Nurachain. It is what markets trade in and what pays the network fee.

**How do I add the Nurachain network?**
Press **Add to wallet** in the footer, and approve it in your wallet.

**Where do the prices come from?**
Other traders. A price only moves because someone bought or sold.

**Can I sell before the market resolves?**
Not at the moment. You hold your position until the market settles.

**What happens if I am wrong?**
Losing shares are worth nothing once the market resolves. What you paid was your risk.

**Who decides the outcome, and when?**
An admin resolves the market after its resolve time, following the source named in the Rules
tab. Claims open immediately afterwards.

**What if a market is cancelled?**
It is marked *voided* and every outcome refunds equally, claimed the same way as winnings.

**My balance or position did not update.**
A transaction has to be confirmed on chain and then indexed before the app shows it. That takes
a moment after the wallet says "confirmed".

**Is my watchlist saved to my account?**
No. It lives in that one browser.

**Are referral rewards paid out automatically?**
The programme tracks what you have earned from fees that reached the treasury. Payouts are
settled from the treasury on chain, not credited as a balance in the app.

**Is any of this financial advice?**
No. Goman is an interface to markets that settle on chain. What you trade, and how much, is
your decision.
