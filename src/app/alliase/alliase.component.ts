import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Peer, DataConnection } from 'peerjs';
import { usedWords } from './used-words';
import { unusedWords } from './unused-words';
import { HttpClient, HttpClientModule } from '@angular/common/http';

interface Player {
  id: string;
  name: string;
  team: number;
  peerId: string;
  isLocal: boolean;
}

interface GameSettings {
  roundTime: number;
  totalRounds: number;
  maxWordLength: number;
  teamsCount: number;
  skipPenalty: number;
}

interface GameState {
  currentRound: number;
  currentPlayerIndex: number;
  currentWord: string;
  scores: number[];
  usedWords: { word: string, guessed: boolean, team: number }[];
  isGameStarted: boolean;
  isGameFinished: boolean;
  isBetweenRounds: boolean;
}

interface RoomInfo {
  roomId: string;
  hostPeerId: string;
  timestamp: number;
}

@Component({
  selector: 'app-alliase',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './alliase.component.html',
  styleUrls: ['./alliase.component.css']
})
export class AlliaseComponent implements OnInit, OnDestroy {
  private lastUpdateTime = 0;
  private serverTimeLeft = 0;
  private lastSyncTimeLeft = 0;
  private localTimeOffset = 0;
  private wordHistory: string[] = [];
  private maxWordHistory = 100;
  private connectionRetries = 0;
  private maxConnectionRetries = 5;
  private timeSyncInterval = 500;
  private lastTimeSync = 0

  gameSettings: GameSettings = {
    roundTime: 60,
    totalRounds: 3,
    maxWordLength: 2,
    teamsCount: 2,
    skipPenalty: 0
  };

  players: Player[] = [];
  newPlayerName = '';
  currentPlayer: Player | null = null;
  nextPlayer: Player | null = null;
  isMobile = false;
  isConnected = false;
  isMainHost = false;
  isCurrentTurnHost = false;

  gameState: GameState = {
    currentRound: 1,
    currentPlayerIndex: 0,
    currentWord: '',
    scores: [],
    usedWords: [],
    isGameStarted: false,
    isGameFinished: false,
    isBetweenRounds: false
  };

  private lastSyncTime = 0;
  private timerStartTime = 0;

  peer: Peer | null = null;
  conn: DataConnection | null = null;
  peerId = '';
  friendPeerId = '';
  connectionStatus = 'Инициализация...';
  showConnectionPanel = true;
  showManualConnect = false;
  manualFriendId = '';
  showPlayerForm = false;
  roomId = '';
  showRoomInput = false;
  isCreatingRoom = false;
  isJoiningRoom = false;

  private gameTimer: any;
  timeLeft = 0;
  private syncTimer: any;
  private allWords: string[] = [];
  private wordBank: string[] = [...unusedWords];

  constructor(private http: HttpClient) { }

  async ngOnInit() {
    this.checkMobile();
    await this.initPeerConnection();
    this.checkUrlParams();
    this.setupConnectionWatchdog();
  }

  private setupConnectionWatchdog() {
    setInterval(() => {
      if (this.conn && this.conn.open && Date.now() - this.lastSyncTime > 3000) {
        this.retryPeerConnection();
      }
    }, 5000);
  }

  @HostListener('window:resize', ['$event'])
  onResize() {
    this.checkMobile();
  }

  checkMobile() {
    this.isMobile = window.innerWidth < 768;
  }

  ngOnDestroy() {
    this.clearTimers();
    if (this.peer) this.peer.destroy();
    if (this.conn) this.conn.close();
    this.leaveRoom();
  }

  async initPeerConnection() {
    try {
      this.connectionStatus = 'Инициализация соединения...';

      if (this.peer) {
        this.peer.destroy();
      }

      this.peer = new Peer({
        debug: 3,
        secure: true,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        this.peerId = id;
        this.connectionStatus = `Готов к подключению.`;
        localStorage.setItem('aliasPeerId', id);
        this.connectionRetries = 0;
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Error:', err);
        this.handlePeerError(err);
      });

      const savedId = localStorage.getItem('aliasPeerId');
      if (savedId) {
        this.peerId = savedId;
        this.connectionStatus = `Используем сохраненный ID...`;
      }

    } catch (err) {
      console.error('Ошибка инициализации Peer:', err);
      this.connectionStatus = 'Ошибка инициализации соединения';
      this.retryPeerConnection();
    }
  }

  async createRoom() {
    if (!this.peerId) {
      alert('Подождите, пока инициализируется соединение');
      return;
    }

    this.isCreatingRoom = true;
    this.connectionStatus = 'Создание комнаты...';

    try {
      // В реальном приложении замените URL на ваш сервер
      const response: any = await this.http.post('https://aliase.vercel.app/api/rooms', {
        hostPeerId: this.peerId
      }).toPromise();

      this.roomId = response.roomId;
      this.isMainHost = true;
      this.connectionStatus = `Комната создана! ID: ${this.roomId}`;
      this.showConnectionPanel = false;
      localStorage.setItem('aliasRoomId', this.roomId);
    } catch (err) {
      console.error('Ошибка создания комнаты:', err);
      this.connectionStatus = 'Ошибка создания комнаты';
      this.isCreatingRoom = false;
    }
  }

  async joinRoom() {
    if (!this.roomId) {
      alert('Введите ID комнаты');
      return;
    }

    this.isJoiningRoom = true;
    this.connectionStatus = 'Подключение к комнате...';

    try {
      // В реальном приложении замените URL на ваш сервер
      const response: any = await this.http.get(`https://your-game-server.com/api/rooms/${this.roomId}`).toPromise();

      if (!response) {
        throw new Error('Комната не найдена');
      }

      this.friendPeerId = response.hostPeerId;
      this.connectToFriend();
      localStorage.setItem('aliasRoomId', this.roomId);
    } catch (err) {
      console.error('Ошибка подключения к комнате:', err);
      this.connectionStatus = 'Ошибка подключения к комнате';
      this.isJoiningRoom = false;
    }
  }

  async leaveRoom() {
    if (this.roomId && this.isMainHost) {
      try {
        await this.http.delete(`https://your-game-server.com/api/rooms/${this.roomId}`).toPromise();
      } catch (err) {
        console.error('Ошибка удаления комнаты:', err);
      }
    }
    this.roomId = '';
    localStorage.removeItem('aliasRoomId');
  }

  handleIncomingConnection(conn: DataConnection) {
    this.conn = conn;
    this.setupConnection();
    this.isMainHost = true; // Только хост получает входящие соединения
    this.connectionStatus = `${conn.peer} подключился!`;
    this.showConnectionPanel = false;
    this.isConnected = true;

    setTimeout(() => {
      this.syncGameState();
    }, 1000);
  }

  handlePeerError(err: any) {
    console.error('PeerJS Error:', err.type, err.message);

    switch (err.type) {
      case 'peer-unavailable':
        this.connectionStatus = 'Ошибка: Соединение недоступно. Проверьте ID друга';
        break;
      case 'network':
        this.connectionStatus = 'Ошибка сети. Проверьте подключение к интернету';
        this.retryPeerConnection();
        break;
      case 'peer-disconnected':
        this.connectionStatus = 'Соединение разорвано. Переподключаемся...';
        this.retryPeerConnection();
        break;
      case 'browser-incompatible':
        this.connectionStatus = 'Ошибка: Ваш браузер не поддерживает WebRTC';
        break;
      default:
        this.connectionStatus = `Ошибка: ${err.message || 'Неизвестная ошибка соединения'}`;
        this.retryPeerConnection();
    }
  }

  retryPeerConnection() {
    setTimeout(() => {
      this.connectionStatus = 'Пытаемся переподключиться...';
      this.initPeerConnection();
    }, 5000);
  }

  setupConnection() {
    if (!this.conn) return;

    const connectionTimeout = setTimeout(() => {
      if (this.connectionStatus.includes('Пытаемся')) {
        this.connectionStatus = 'Таймаут соединения. Проверьте сеть';
        this.conn?.close();
      }
    }, 15000);

    this.conn.on('open', () => {
      clearTimeout(connectionTimeout);
      this.connectionStatus = 'Подключено!';
      this.showConnectionPanel = false;
      this.isConnected = true;

      if (this.isMainHost) {
        localStorage.setItem('aliasHostConnection', JSON.stringify({
          peerId: this.conn?.peer,
          timestamp: Date.now()
        }));
        this.syncGameState();
      }
    });

    this.conn.on('data', (data: any) => {
      this.handleIncomingData(data);
    });

    this.conn.on('close', () => {
      clearTimeout(connectionTimeout);
      this.connectionStatus = 'Соединение закрыто';
      this.isConnected = false;
      if (this.gameState.isGameStarted && !this.gameState.isGameFinished) {
        alert('Соединение потеряно! Попробуйте переподключиться.');
      }
    });

    this.conn.on('error', (err) => {
      clearTimeout(connectionTimeout);
      console.error('Connection error:', err);
      this.connectionStatus = 'Ошибка соединения';
      this.isConnected = false;
    });
  }

  async connectToFriend() {
    if (!this.friendPeerId) {
      alert('Введите ID друга');
      return;
    }

    if (!this.peer) {
      alert('Соединение еще не инициализировано');
      return;
    }

    this.connectionStatus = 'Подключаемся...';
    try {
      this.conn = this.peer.connect(this.friendPeerId);
      if (this.conn) {
        this.isMainHost = false; // Клиент не является ведущим
        this.setupConnection();
      } else {
        this.connectionStatus = 'Ошибка при создании соединения';
      }
    } catch (err) {
      console.error('Ошибка подключения:', err);
      this.connectionStatus = 'Ошибка при подключении';
    }
  }

  connectManually() {
    if (!this.manualFriendId) {
      alert('Введите ID друга');
      return;
    }
    this.friendPeerId = this.manualFriendId;
    this.connectToFriend();
    this.showManualConnect = false;
  }

  showAddPlayerForm() {
    // Показываем форму только если игрок еще не добавлен
    if (!this.players.some(p => p.peerId === this.peerId)) {
      this.showPlayerForm = true;
    } else {
      alert('Вы уже в игре!');
    }
  }

  addPlayer() {
    if (!this.newPlayerName.trim()) {
      alert('Введите имя игрока');
      return;
    }

    // Проверяем, не добавлен ли уже этот игрок
    if (this.players.some(p => p.peerId === this.peerId)) {
      alert('Вы уже добавлены в игру');
      return;
    }

    const team = this.players.length % this.gameSettings.teamsCount;
    const newPlayer: Player = {
      id: Date.now().toString(),
      name: this.newPlayerName.trim(),
      team,
      peerId: this.peerId,
      isLocal: true
    };

    this.players.push(newPlayer);
    this.newPlayerName = '';
    this.showPlayerForm = false;

    if (this.isMainHost) {
      this.syncGameState();
    } else {
      this.sendPlayerUpdate('add', newPlayer);
    }
  }

  removePlayer(playerId: string) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return;

    if (player.isLocal || this.isMainHost) {
      this.players = this.players.filter(p => p.id !== playerId);

      if (this.isMainHost) {
        this.syncGameState();
      } else {
        this.sendPlayerUpdate('remove', player);
      }
    }
  }

  sendPlayerUpdate(action: 'add' | 'remove', player: Player) {
    if (!this.conn) return;

    try {
      this.conn.send({
        type: 'playerUpdate',
        action,
        player
      });
    } catch (err) {
      console.error('Ошибка отправки обновления игрока:', err);
    }
  }

  startGame() {
    if (this.players.length < 2) {
      alert('Нужно минимум 2 игрока...');
      return;
    }

    this.prepareWords();
    this.gameState = {
      currentRound: 1,
      currentPlayerIndex: 0,
      currentWord: '',
      scores: new Array(this.gameSettings.teamsCount).fill(0),
      usedWords: [],
      isGameStarted: true,
      isGameFinished: false,
      isBetweenRounds: false
    };

    if (this.isMainHost) {
      this.syncGameState();
    }
  }

  startPlayerTurn() {
    this.currentPlayer = this.players[this.gameState.currentPlayerIndex];
    this.nextPlayer = this.players[(this.gameState.currentPlayerIndex + 1) % this.players.length];
    this.isCurrentTurnHost = this.currentPlayer.peerId === this.peerId;
    this.timeLeft = this.gameSettings.roundTime;
    this.lastUpdateTime = Date.now();
    this.serverTimeLeft = this.timeLeft;
    this.gameState.currentWord = this.getNextWord();

    this.clearTimer();

    this.gameTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - this.lastUpdateTime) / 1000;
      this.lastUpdateTime = now;

      if (this.isCurrentTurnHost) {
        this.timeLeft = Math.max(0, this.timeLeft - elapsed);

        if (now - this.lastSyncTime > 1000) {
          this.lastSyncTime = now;
          this.serverTimeLeft = this.timeLeft;
          this.syncGameState();
        }
      } else {
        this.timeLeft = Math.max(0, this.serverTimeLeft - (now - this.lastSyncTime) / 1000);
      }

      if (this.timeLeft <= 0) {
        this.clearTimer();
        if (this.isCurrentTurnHost) {
          this.endPlayerTurn();
        }
      }
    }, 100);

    this.setupSyncTimer();
  }
  private handleTimeSync(data: any) {
    if (this.isCurrentTurnHost) return;

    if (data.round !== this.gameState.currentRound || 
        data.turn !== this.gameState.currentPlayerIndex) {
      return;
    }

    const now = Date.now();
    this.serverTimeLeft = data.timeLeft;
    this.lastSyncTimeLeft = now;
    this.localTimeOffset = now - data.serverTime;

    this.timeLeft = Math.max(0, this.serverTimeLeft - (now - this.lastSyncTimeLeft) / 1000);
  }
  private syncTime() {
    if (!this.isCurrentTurnHost || !this.conn || !this.conn.open) return;

    this.lastSyncTimeLeft = Date.now();
    this.lastTimeSync = Date.now();

    try {
      this.conn.send({
        type: 'timeSync',
        timeLeft: this.timeLeft,
        serverTime: Date.now(),
        round: this.gameState.currentRound,
        turn: this.gameState.currentPlayerIndex
      });
    } catch (err) {
      console.error('Ошибка синхронизации времени:', err);
    }
  }


  private setupSyncTimer() {
    if (this.syncTimer) clearInterval(this.syncTimer);

    this.syncTimer = setInterval(() => {
      if (this.isCurrentTurnHost && this.conn) {
        this.syncTime();
      }
    }, 1000);
  }

  endPlayerTurn() {
    this.clearTimer();
    this.clearSyncTimer();
    this.gameState.isBetweenRounds = true;
    this.isCurrentTurnHost = false;

    if (this.isMainHost) {
      this.syncGameState();
    }
  }

  async copyToClipboard(text: string) {
    if (!text) {
      alert('Нет данных для копирования');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      alert('Скопировано в буфер обмена!');
    } catch (err) {
      console.error('Copy failed:', err);
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      document.body.appendChild(textarea);
      textarea.select();

      try {
        const success = document.execCommand('copy');
        if (!success) throw new Error('Copy command failed');
        alert('Скопировано (использован старый метод)');
      } catch (err) {
        console.error('Fallback copy failed:', err);
        alert('Не удалось скопировать текст');
      } finally {
        document.body.removeChild(textarea);
      }
    }
  }

  continueGame() {
    if (!this.canContinueGame()) return;

    this.gameState.isBetweenRounds = false;
    this.gameState.currentPlayerIndex++;

    if (this.gameState.currentPlayerIndex >= this.players.length) {
      this.gameState.currentPlayerIndex = 0;
      this.gameState.currentRound++;

      if (this.gameState.currentRound > this.gameSettings.totalRounds) {
        this.endGame();
        return;
      }
    }

    this.startPlayerTurn();
  }

  endGame() {
    this.gameState.isGameFinished = true;
    this.gameState.isGameStarted = false;

    if (this.isMainHost) {
      this.syncGameState();
    }
  }

  prepareWords() {
    if (this.wordHistory.length > this.maxWordHistory) {
      this.wordHistory = this.wordHistory.slice(-this.maxWordHistory);
    }

    // Объединяем стандартные неиспользованные слова с дополнительными
    const availableWords = [...this.wordBank, ...unusedWords]
      .filter(word =>
        !this.gameState.usedWords.some(used => used.word === word) &&
        !this.wordHistory.includes(word) &&
        word.split(' ').length <= this.gameSettings.maxWordLength
      );

    // Удаляем дубликаты
    const uniqueWords = [...new Set(availableWords)];

    // Перемешиваем слова
    this.allWords = uniqueWords
      .sort(() => Math.random() - 0.5)
      .sort(() => Math.random() - 0.5)
      .slice(0, this.players.length * this.gameSettings.totalRounds * 10);

    this.wordHistory.push(...this.allWords);
  }

  getNextWord(): string {
    if (this.allWords.length === 0) {
      this.prepareWords();
    }

    if (this.allWords.length === 0) {
      // Если слова все равно закончились, сбрасываем историю
      this.wordHistory = [];
      this.gameState.usedWords = [];
      this.prepareWords();
    }

    const nextWord = this.allWords.pop() || 'Слово не найдено';
    return nextWord;
  }

  handleAnswer(isCorrect: boolean) {
    if (!this.currentPlayer || !this.isCurrentTurnHost) return;

    this.gameState.usedWords.push({
      word: this.gameState.currentWord,
      guessed: isCorrect,
      team: this.currentPlayer.team
    });

    if (isCorrect) {
      this.gameState.scores[this.currentPlayer.team]++;
    } else {
      this.gameState.scores[this.currentPlayer.team] -= this.gameSettings.skipPenalty;
    }

    this.gameState.currentWord = this.getNextWord();
    this.syncGameState();
  }
  canContinueGame(): boolean {
    if (!this.nextPlayer) return false;

    // Кнопка "Продолжить" показывается:
    // 1. У следующего игрока (который будет ходить)
    // 2. Или у ведущего (если следующий игрок неактивен)
    return this.nextPlayer.peerId === this.peerId ||
      (this.isMainHost && !this.players.some(p => p.peerId === this.nextPlayer?.peerId));
  }

  syncGameState() {
    if (!this.conn) return;

    try {
      this.conn.send({
        type: 'gameState',
        data: {
          settings: this.gameSettings,
          players: this.players,
          gameState: this.gameState,
          currentPlayer: this.currentPlayer,
          nextPlayer: this.nextPlayer,
          timeLeft: this.timeLeft,
          isMainHost: this.isMainHost
        }
      });
    } catch (err) {
      console.error('Ошибка синхронизации:', err);
    }
  }

  handleIncomingData(data: any) {
    if (!data) return;

    switch (data.type) {
      case 'gameState':
        this.gameSettings = data.data.settings;
        this.players = data.data.players;
        this.gameState = data.data.gameState;
        this.currentPlayer = data.data.currentPlayer;
        this.nextPlayer = data.data.nextPlayer;
        this.isMainHost = data.data.isMainHost;

        if (this.currentPlayer) {
          this.isCurrentTurnHost = this.currentPlayer.peerId === this.peerId;
        }

        if (data.data.gameState.isGameStarted && !data.data.gameState.isBetweenRounds) {
          this.serverTimeLeft = data.data.timeLeft;
          this.lastSyncTime = Date.now();

          if (!this.gameTimer) {
            this.startPlayerTurn();
          }
        }
        break;

      case 'timeSync':
        this.handleTimeSync(data);
        break;

      case 'playerUpdate':
        this.handlePlayerUpdate(data);
        break;
    }
  }
  shouldShowAddPlayerButton(): boolean {
    return !this.showPlayerForm &&
      this.isConnected &&
      !this.players.some(p => p.peerId === this.peerId);
  }
  handlePlayerUpdate(data: any) {
    if (data.action === 'add') {
      // Проверяем, нет ли уже игрока с таким peerId
      if (!this.players.some(p => p.peerId === data.player.peerId)) {
        this.players.push(data.player);
        if (this.isMainHost) {
          this.syncGameState();
        }
      }
    } else if (data.action === 'remove') {
      this.players = this.players.filter(p => p.id !== data.player.id);
      if (this.isMainHost) {
        this.syncGameState();
      }
    }
  }

  private validatePlayers(players: Player[]): Player[] {
    return players.filter(player =>
      player &&
      player.id &&
      player.name &&
      player.team >= 0 &&
      player.team < this.gameSettings.teamsCount
    );
  }
  generateInviteLink(): string {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?room=${this.roomId}`;
  }

  checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');

    if (roomId) {
      this.roomId = roomId;
      this.showRoomInput = true;
    }
  }

  getCurrentTeamPlayers(teamIndex: number): Player[] {
    return this.players.filter(player => player.team === teamIndex);
  }

  getWinnerTeam(): number | null {
    if (!this.gameState.isGameFinished) return null;

    const maxScore = Math.max(...this.gameState.scores);
    const winningTeams = this.gameState.scores.reduce((acc, score, index) => {
      if (score === maxScore) acc.push(index);
      return acc;
    }, [] as number[]);

    return winningTeams.length === 1 ? winningTeams[0] : null;
  }

  private clearTimer() {
    if (this.gameTimer) {
      clearInterval(this.gameTimer);
      this.gameTimer = null;
    }
  }

  private clearSyncTimer() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private clearTimers() {
    this.clearTimer();
    this.clearSyncTimer();
  }

  restartGame() {
    this.gameState.isGameFinished = false;
    this.startGame();
  }
}
