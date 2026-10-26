<div align="center">
    <picture>
        <img src="https://windowscraft76.fr/assets/www/projects/botfront.png" alt="Banner" width="128" height="128">
    </picture>
    <p>
        <a href="https://github.com/WindowsCraft76/botfront/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/WindowsCraft76/botfront?style=for-the-badge"></a>
        <a href="https://www.python.org/downloads/release/python-3140/"><img alt="Discord.js" src="https://img.shields.io/badge/discord.js-14.27.0-%230D7BBB?style=for-the-badge"></a>
        <a href="http://kofi.windowscraft76.fr/"><img alt="ko-fi" src="https://img.shields.io/badge/Support_me_on_Ko--fi-FF5A16?logo=ko-fi&logoColor=white&style=for-the-badge"></a>
        <br>
        <a href="https://windowscraft76.fr/botfront/invite/"><img alt="Invite" src="https://img.shields.io/badge/invite_BOTFRONT_to_your server-8A2BE2?style=for-the-badge"></a>
        <a href="https://windowscraft76.fr/botfront/issues/"><img alt="Issues" src="https://img.shields.io/badge/issues-red?style=for-the-badge"></a>
    </p>
    <p>
        <b>Unofficial bot to check BlockFront stats on Discord!</b>
    </p>
</div>

---

**BotFront** is a Discord bot developed with **Node.js** and **discord.js v14**, designed to interact with the official [**BlockFront**](https://www.blockfrontmc.com/) API. It allows users to view player and clan statistics, monthly leaderboards, official rules, and other upcoming features.

## ✨ Features

* 📊 **`/stats <name>`** : Displays a player's detailed statistics: Combat, Progression, Objectives, Class EXP, Infected Mode, Playtime, etc.
* 🛡️ **`/clan <tag>`** : Displays information about a clan: Ranks, Monthly Score, Founder, Members, and Roles.
* 🏆 **`/scoreboard [players|clans]`** : Displays the monthly leaderboard for players or clans.
* 📜 **`/rules`** : Displays the official BlockFront rules.
* 🏓 **`/ping`** : Shows the bot's latency (WebSocket / Commands), as well as the status and response time of the BlockFront API.
* 🟢 **Presence** : Displays the number of players online on BlockFront in real time.

---

## For developers:

## 🛠️ Requirements

* [**Node.js**](https://nodejs.org/) (v24.19.0 or more recent)
* [**Discord.js**](https://discord.js.org/) (v14.27.0)
* A **Discord bot token** (`TOKEN`) and the **client ID** (`CLIENT_ID`)
* Access to the BlockFront API (**URL** and **API Key**)

## 🚀 Installation & Configuration

### 1. Clone the project & Install dependencies

```bash
git clone https://github.com/WindowsCraft76/botfront
cd botfront
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root based on the structure of `.env.example`:

```env
# Discord Configuration
TOKEN=YOUR_BOT_TOKEN
CLIENT_ID=YOUR_BOT_ID

# BlockFront API Configuration
BLOCKFRONT_API_URL=https://api.blockfrontmc.com/api/v2/
BLOCKFRONT_API_KEY=YOUR_API_KEY

# Optional (Log level: debug, info, warn, error)
LOG_LEVEL=info
```

## 📦 Running

To start the bot:

```bash
npm start
```

---

## 📋 Available Commands

| Commande | Argument(s) | Description |
| :--- | :--- | :--- |
| `/ping` | None | Shows the bot and BlockFront API latency. |
| `/stats` | `name` *(required)* | Shows the stats of a BlockFront player. |
| `/clan` | `tag` *(required)* | Shows the info of a BlockFront clan. |
| `/scoreboard` | Subcommand (`players` / `clans`) | Shows the BlockFront monthly scoreboard. |
| `/rules` | None | Shows the offcial BlockFront rules. |

## ⚠️ Disclaimer

This project is an independent community-created project and **is not an official tool**.

* **BotFront** is in no way affiliated with, associated with, approved by, or endorsed by **BlockFront** ou **Mojang Studios** / **Microsoft**.
* Minecraft is a trademark of Mojang Synergies AB.
* The emojis and visuals used by the bot include resources (*assets*) taken directly from the BlockFront project. These resources remain the exclusive property of their respective creators and are used under their original license.

## 📄 Licence

This project is distributed under the MIT license. See [here](https://github.com/WindowsCraft76/botfront/blob/main/LICENSE) for more details.
