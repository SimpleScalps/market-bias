// Krypto-Ereignistypen mit ihrer Handelswirkung.
//
// base     : Grundwirkung auf den Markt (0 = ignorieren, 4 = extrem)
// duration : Wie lange die Meldung typischerweise nachwirkt
//              'scalp'    < 1 Stunde
//              'intraday' 1–24 Stunden
//              'swing'    1–7 Tage
//              'long'     > 7 Tage
// scope    : 'market' bewegt den Gesamtmarkt, 'coin' nur den genannten Coin,
//            'project' nur ein Einzelprojekt (für Scalper meist irrelevant)
//
// Die Reihenfolge entscheidet: das erste Muster gewinnt, deshalb stehen die
// schwerwiegenden Ereignisse oben.

export const CRYPTO_EVENTS = [
  // ---------- Extrem: bewegt den Gesamtmarkt sofort ----------
  { re: /\b(exchange|binance|coinbase|kraken|okx|bybit|bitfinex|upbit)\b[^.]{0,40}\b(hack|hacked|exploit|breach|drained|stolen)\b/i,
    typ: 'Börsen-Hack', typEn: 'Exchange hack', base: 4, duration: 'swing', scope: 'market' },
  { re: /\b(halts?|suspend\w*|freez\w+|pauses?)\b[^.]{0,30}\b(withdrawal|trading|deposits)\b/i,
    typ: 'Auszahlungsstopp', typEn: 'Withdrawals halted', base: 4, duration: 'swing', scope: 'market' },
  { re: /\b(bankrupt\w*|insolven\w+|collapse[sd]?|files? for chapter)\b/i,
    typ: 'Insolvenz', typEn: 'Insolvency', base: 4, duration: 'long', scope: 'market' },
  { re: /\b(bridge|protocol|defi|wallet)\b[^.]{0,30}\b(hack|exploit|drained|stolen)\b/i,
    typ: 'Protokoll-Exploit', typEn: 'Protocol exploit', base: 3, duration: 'intraday', scope: 'market' },

  // ---------- Hoch: strukturelle Weichenstellungen ----------
  { re: /\b(spot )?etf\b[^.]{0,30}\b(approv\w+|reject\w+|deni\w+|decision|launch\w*|filing)\b|\b(approv\w+|reject\w+)\b[^.]{0,20}\betf\b/i,
    typ: 'ETF-Entscheidung', typEn: 'ETF decision', base: 4, duration: 'long', scope: 'market' },
  { re: /\betf\b[^.]{0,30}\b(inflow|outflow|flows)\w*|\b(inflow|outflow)\w*[^.]{0,20}\betf\b/i,
    typ: 'ETF-Flüsse', typEn: 'ETF flows', base: 2, duration: 'intraday', scope: 'market' },
  { re: /\b(sec|cftc|doj|treasury|regulator\w*)\b[^.]{0,40}\b(sues?|charges?|lawsuit|investigat\w+|enforcement|settle\w*|approv\w+)\b/i,
    typ: 'Regulierungsverfahren', typEn: 'Regulatory action', base: 3, duration: 'swing', scope: 'market' },
  { re: /\b(ban(s|ned)?|crackdown|prohibit\w+|outlaw\w*)\b[^.]{0,30}\b(crypto|bitcoin|mining|exchange)\b/i,
    typ: 'Verbot', typEn: 'Ban', base: 3, duration: 'long', scope: 'market' },
  { re: /\b(bill|law|legislation|regulat\w+ framework|mica|clarity act)\b[^.]{0,40}\b(passe[sd]|sign\w+|approv\w+|vote[sd]?)\b/i,
    typ: 'Gesetzgebung', typEn: 'Legislation', base: 3, duration: 'long', scope: 'market' },
  { re: /\b(strategic (bitcoin )?reserve|national reserve|government (buys|holdings|sells))\b/i,
    typ: 'Staatliche Reserve', typEn: 'Government reserve', base: 3, duration: 'long', scope: 'market' },

  // ---------- Mittel: Fluss- und Positionierungssignale ----------
  { re: /\bwhale[s]?\b|\b(large|massive)\b[^.]{0,20}\b(transfer|withdrawal|deposit)\b|\bmoves? \$?\d+[\d.,]*\s*(m|b|million|billion)\b/i,
    typ: 'Whale-Bewegung', typEn: 'Whale transfer', base: 2, duration: 'scalp', scope: 'market' },
  { re: /\b(liquidat\w+|forced selling|margin call|short squeeze|long squeeze)\b/i,
    typ: 'Liquidationen', typEn: 'Liquidations', base: 2, duration: 'scalp', scope: 'market' },
  { re: /\b(microstrategy|strategy|tesla|metaplanet|treasury compan\w+)\b[^.]{0,30}\b(buys?|bought|adds?|purchas\w+|sells?)\b/i,
    typ: 'Unternehmenskauf', typEn: 'Corporate purchase', base: 2, duration: 'intraday', scope: 'market' },
  { re: /\b(miner[s]?|mining|hashrate)\b[^.]{0,30}\b(capitulat\w+|sell\w*|shut\w*|difficulty)\b/i,
    typ: 'Miner-Verhalten', typEn: 'Miner behaviour', base: 2, duration: 'intraday', scope: 'market' },
  { re: /\b(halving|network upgrade|hard fork|mainnet launch|merge)\b/i,
    typ: 'Netzwerk-Ereignis', typEn: 'Network event', base: 2, duration: 'swing', scope: 'coin' },
  { re: /\b(listing|listed on|delisting|delisted)\b/i,
    typ: 'Listing', typEn: 'Listing', base: 2, duration: 'intraday', scope: 'coin' },
  { re: /\b(stablecoin|usdt|usdc|tether)\b[^.]{0,30}\b(depeg\w*|redemption|reserve|audit)\b/i,
    typ: 'Stablecoin-Risiko', typEn: 'Stablecoin risk', base: 3, duration: 'intraday', scope: 'market' },

  // ---------- Niedrig: nett zu wissen, bewegt selten ----------
  { re: /\b(partner\w+|collaborat\w+|integrat\w+|teams? up|joins? forces)\b/i,
    typ: 'Partnerschaft', typEn: 'Partnership', base: 1, duration: 'scalp', scope: 'project' },
  { re: /\b(launch\w*|releas\w+|unveil\w+|introduc\w+|rollout)\b/i,
    typ: 'Produktankündigung', typEn: 'Product announcement', base: 1, duration: 'scalp', scope: 'project' },
  { re: /\b(price prediction|could hit|analyst says|forecast\w*|target of|eyes \$)\b/i,
    typ: 'Kursprognose', typEn: 'Price prediction', base: 0, duration: 'scalp', scope: 'project' },
  { re: /\b(airdrop|nft|meme ?coin|testnet|roadmap|ama|community vote|staking rewards)\b/i,
    typ: 'Projekt-Update', typEn: 'Project update', base: 0, duration: 'scalp', scope: 'project' },
];

export function matchCryptoEvent(title) {
  for (const e of CRYPTO_EVENTS) if (e.re.test(title)) return e;
  return null;
}

// Welche Coins kommen vor? Bestimmt, ob eine Meldung zum Profil des Nutzers passt.
export const COINS = [
  { key: 'BTC', re: /\b(btc|bitcoin)\b/i },
  { key: 'ETH', re: /\b(eth|ethereum|ether)\b/i },
  { key: 'SOL', re: /\b(sol|solana)\b/i },
  { key: 'XRP', re: /\b(xrp|ripple)\b/i },
  { key: 'BNB', re: /\b(bnb|binance coin)\b/i },
  { key: 'DOGE', re: /\b(doge|dogecoin)\b/i },
  { key: 'ADA', re: /\b(ada|cardano)\b/i },
];

export function coinsIn(title) {
  return COINS.filter((c) => c.re.test(title)).map((c) => c.key);
}
