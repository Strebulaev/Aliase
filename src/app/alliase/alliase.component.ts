import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Peer, DataConnection } from 'peerjs';
import { HttpClient } from '@angular/common/http';
import { usedWords } from './used-words';
import { unusedWords } from './unused-words';
import { lastValueFrom } from 'rxjs';
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

@Component({
    selector: 'app-alliase',
    standalone: true,
    imports: [CommonModule, FormsModule],
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
    private timeSyncInterval = 500;
    private lastTimeSync = 0;

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

  constructor(private http: HttpClient)
  {
    window.addEventListener('beforeunload', () => {
      if (this.peer) {
        this.peer.destroy();
      }
    });
  }

    async ngOnInit() {
        this.checkMobile();
        await this.initPeerConnection();
        this.setupConnectionWatchdog();
        try {
          await this.initializePeerConnection();
        } catch (err) {
          console.error('Ошибка подключения:', err);
          this.connectionStatus = 'Ошибка подключения. Обновите страницу.';

          // Автоматическая перезагрузка через 5 секунд
          setTimeout(() => {
            window.location.reload();
          }, 5000);
        }
    }

  private setupConnectionWatchdog() {
    setInterval(() => {
      if (!this.peer || !this.conn) return;

      // Проверяем активность соединения
      if (this.conn.open && Date.now() - this.lastSyncTime > 10000) {
        try {
          // Отправляем ping-сообщение
          this.conn.send({
            type: 'ping',
            timestamp: Date.now()
          });
        } catch (err) {
          console.error('Ping failed:', err);
          this.retryPeerConnection();
        }
      }

      // Проверяем состояние peer
      if (this.peer.disconnected) {
        this.connectionStatus = 'Переподключение...';
        this.peer.reconnect();
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
    }
  private generateTabId(): string {
    const tabId = sessionStorage.getItem('tabId') ||
      Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem('tabId', tabId);
    return tabId;
  }
  // В вашем компоненте
  private tryConnectToServer(server: any): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connectionStatus = `Подключение к ${server.host}...`;

      if (this.peer) {
        this.peer.destroy();
      }

      const timeout = setTimeout(() => {
        reject(new Error('Таймаут подключения'));
      }, 8000);

      this.peer = new Peer({
        host: server.host,
        port: server.port || 443,
        secure: server.secure,
        key: server.key,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        clearTimeout(timeout);
        this.peerId = id;
        this.connectionStatus = 'Готов к подключению';
        resolve();
      });

      this.peer.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
  private async initializePeerConnection(): Promise<void> {
    const servers = [
      { host: '0.peerjs.com', secure: false, key: 'peerjs' },
      { host: '1.peerjs.com', secure: false, key: 'peerjs' },
    ];

    for (const server of servers) {
      try {
        await this.tryConnectToServer(server);
        return; // Успешное подключение
      } catch (err) {
        console.warn(`Не удалось подключиться к ${server.host}`, err);
        this.connectionStatus = `Пробуем другой сервер...`;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    throw new Error('Все серверы недоступны');
  }
  async initPeerConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.peer) {
        this.peer.destroy();
      }

      // Пробуем использовать сохраненный ID или создаем новый
      const savedPeerId = localStorage.getItem('aliasPeerId');
      const peerIdPrefix = savedPeerId || `alias-${Math.random().toString(36).substring(2, 9)}`;

      this.peer = new Peer(peerIdPrefix, {
        debug: 2,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        this.peerId = id;
        localStorage.setItem('aliasPeerId', id);
        resolve();
      });

      this.peer.on('error', err => {
        // При ошибке пробуем с новым ID
        localStorage.removeItem('aliasPeerId');
        this.initPeerConnection().then(resolve).catch(reject);
      });
    });
  }

  async createRoom() {
    if (!this.peerId) {
      alert('Подождите, пока инициализируется соединение');
      return;
    }

    this.isCreatingRoom = true;
    this.connectionStatus = 'Создание комнаты...';

    try {
      // Добавляем тип для ответа
      interface RoomResponse {
        roomId: string;
        status: string;
        // другие поля ответа, если они есть
      }

      const response = await lastValueFrom(
        this.http.post<RoomResponse>('https://aliase.vercel.app/api/rooms', {
          hostPeerId: this.peerId
        })
      );

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
      const response: any = await this.http.get(`https://aliase.vercel.app/api/rooms/${this.roomId}`).toPromise();

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

  private handleIncomingConnection(conn: any) {
    if (!conn) return; // Проверка на null

    this.conn = conn;

    conn.on('data', (data: any) => {
      if (!data) return; // Проверка входящих данных

      try {
        if (data.type === 'game-state') {
          this.applyGameState(data.state);
        }
      } catch (err) {
        console.error('Ошибка обработки данных:', err);
      }
    });

    conn.on('error', (err: any) => {
      console.error('Ошибка соединения:', err);
      this.connectionStatus = 'Ошибка подключения';
    });
  }

  handlePeerError(err: any) {
    console.error('PeerJS Error:', err.type, err.message);

    switch (err.type) {
      case 'peer-unavailable':
        this.connectionStatus = 'Друг недоступен. Проверьте ID';
        break;
      case 'network':
        this.connectionStatus = 'Проблемы с сетью';
        this.retryPeerConnection();
        break;
      case 'disconnected':
        this.connectionStatus = 'Соединение потеряно. Переподключаемся...';
        this.initPeerConnection();
        break;
      default:
        this.connectionStatus = `Ошибка: ${err.message || 'Неизвестная ошибка'}`;
    }

    this.showManualConnect = true;
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

  async connectToFriend(): Promise<boolean> {
    if (!this.friendPeerId) {
      alert('Введите ID друга');
      return false;
    }

    // Добавляем явную проверку на null
    if (!this.peer) {
      alert('Соединение не инициализировано');
      return false;
    }

    // Проверка на попытку подключения к самому себе
    if (this.friendPeerId === this.peerId) {
      this.connectionStatus = 'Нельзя подключиться к самому себе';
      return false;
    }

    this.connectionStatus = 'Подключение к другу...';

    try {
      // Закрываем предыдущее соединение, если оно есть
      if (this.conn) {
        this.conn.close();
      }

      return new Promise<boolean>((resolve) => {
        // Устанавливаем таймаут подключения
        const connectionTimeout = setTimeout(() => {
          this.connectionStatus = 'Таймаут подключения. Проверьте ID и сеть';
          if (this.conn && !this.conn.open) {
            this.conn.close();
          }
          resolve(false);
        }, 15000);

        // Добавляем проверку TypeScript, что peer существует
        if (!this.peer) {
          clearTimeout(connectionTimeout);
          this.connectionStatus = 'Соединение не инициализировано';
          resolve(false);
          return;
        }

        // Теперь TypeScript знает, что this.peer не null
        const conn = this.peer.connect(this.friendPeerId, {
          reliable: true,
          serialization: 'json',
          metadata: {
            game: 'alias',
            version: '1.0',
            playerName: this.newPlayerName || 'Anonymous'
          }
        });

        conn.on('open', () => {
          clearTimeout(connectionTimeout);
          this.handleIncomingConnection(conn);
          this.connectionStatus = 'Подключено!';
          this.showConnectionPanel = false;
          this.isConnected = true;
          resolve(true);
        });

        conn.on('error', (err) => {
          clearTimeout(connectionTimeout);
          console.error('Connection error:', err);
          this.connectionStatus = 'Ошибка подключения';
          resolve(false);
        });
      });
    } catch (err) {
      console.error('Ошибка подключения:', err);
      this.connectionStatus = 'Ошибка подключения';
      return false;
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

    const now = Date.now();
    // Не синхронизируем слишком часто
    if (now - this.lastTimeSync < this.timeSyncInterval) return;

    this.lastSyncTimeLeft = now;
    this.lastTimeSync = now;

    try {
      this.conn.send({
        type: 'timeSync',
        timeLeft: this.timeLeft,
        serverTime: now,
        round: this.gameState.currentRound,
        turn: this.gameState.currentPlayerIndex,
        pingId: Math.random().toString(36).substring(2, 9)
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
      try {
        // Fallback для старых браузеров
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        document.body.appendChild(textarea);
        textarea.select();

        const success = document.execCommand('copy');
        document.body.removeChild(textarea);

        if (!success) throw new Error('Copy command failed');
        alert('Скопировано (использован старый метод)');
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
        alert('Не удалось скопировать текст');
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

  private syncGameState() {
    if (!this.conn || !this.conn.open) return; // Добавляем проверку на open

    try {
      this.conn.send({
        type: 'game-state',
        state: {
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
  private applyGameState(state: any) {
    if (!state) return;

    if (state.settings) this.gameSettings = { ...this.gameSettings, ...state.settings };
    if (state.players) this.players = [...state.players];
    if (state.gameState) this.gameState = { ...this.gameState, ...state.gameState };
    if (state.currentPlayer) this.currentPlayer = { ...state.currentPlayer };
    if (state.nextPlayer) this.nextPlayer = { ...state.nextPlayer };
    if (state.timeLeft) this.timeLeft = state.timeLeft;
    if (state.isMainHost !== undefined) this.isMainHost = state.isMainHost;
  }


  private handleIncomingData(data: any) {
    if (!data || typeof data !== 'object') return;

    // Проверка ping-сообщений
    if (data.type === 'ping') {
      this.lastSyncTime = Date.now();
      return;
    }

    // Валидация основных данных
    if (!data.type || !data.state) return;

    try {
      // Применяем только если данные новее текущего состояния
      if (data.timestamp && data.timestamp < this.lastSyncTime) {
        return;
      }

      switch (data.type) {
        case 'game-state':
          this.applyGameState(data.state);
          this.lastSyncTime = Date.now();
          break;

        case 'timeSync':
          this.handleTimeSync(data);
          break;

        case 'playerUpdate':
          this.handlePlayerUpdate(data);
          break;
      }
    } catch (err) {
      console.error('Ошибка обработки данных:', err);
    }
  }

  shouldShowAddPlayerButton(): boolean {
    return !this.showPlayerForm &&
      this.isConnected &&
      !this.players.some(p => p.peerId === this.peerId);
  }

  // Пример для метода handlePlayerUpdate
  handlePlayerUpdate(data: any) {
    if (!data || !data.player) return; // Проверка на null/undefined

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
