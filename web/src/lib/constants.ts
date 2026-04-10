export interface TagItem {
  value: string;
  label: string;
}

export interface TagCategory {
  category: string;
  tags: TagItem[];
}

export const TAG_CATEGORIES: TagCategory[] = [
  {
    category: '基本戦法',
    tags: [
      { value: 'ibisha', label: '居飛車' },
      { value: 'furibisha', label: '振り飛車' },
      { value: 'aigakari', label: '相掛かり' },
      { value: 'kakugawari', label: '角換わり' },
      { value: 'yokofudori', label: '横歩取り' },
      { value: 'migishiken', label: '右四間飛車' },
      { value: 'mukaibisha', label: '向飛車' },
      { value: 'sanken', label: '三間飛車' },
      { value: 'shiken', label: '四間飛車' },
      { value: 'nakabisha', label: '中飛車' },
      { value: 'kakukoukan', label: '角交換振り飛車' },
      { value: 'aifuribisha', label: '相振り飛車' },
      { value: 'sodebisha', label: '袖飛車' },
    ],
  },
  {
    category: '基本囲い',
    tags: [
      { value: 'funagakoi', label: '船囲い' },
      { value: 'yagura', label: '矢倉' },
      { value: 'gangi', label: '雁木' },
      { value: 'hakoirimusume', label: '箱入り娘' },
      { value: 'migigyoku', label: '右玉' },
      { value: 'hidarigyoku', label: '左玉' },
      { value: 'ibisha_millennium', label: '居飛車ミレニアム' },
      { value: 'ibisha_anaguma', label: '居飛車穴熊' },
      { value: 'kani_gakoi', label: 'カニ囲い' },
      { value: 'bonanza_gakoi', label: 'ボナンザ囲い' },
      { value: 'hidari_mino', label: '左美濃' },
      { value: 'tenshukaku', label: '天守閣' },
      { value: 'mino_gakoi', label: '美濃囲い' },
      { value: 'ginkanmuri', label: '銀冠' },
      { value: 'kinmusou', label: '金無双' },
      { value: 'migi_yagura', label: '右矢倉' },
      { value: 'furibisha_millennium', label: '振り飛車ミレニアム' },
      { value: 'furibisha_anaguma', label: '振り飛車穴熊' },
      // Legacy tag for backward compatibility with previously saved data
      { value: 'anaguma', label: '穴熊' },
    ],
  },
  {
    category: 'プロ戦法',
    tags: [
      { value: 'waki_system', label: '脇システム' },
      { value: 'morishita_system', label: '森下システム' },
      { value: 'yonenaga_kyusen_yagura', label: '米長流急戦矢倉' },
      { value: 'nakahara_kyusen_yagura', label: '中原流急戦矢倉' },
      { value: 'akutsu_kyusen_yagura', label: '阿久津流急戦矢倉' },
      { value: 'tsukada_special', label: '塚田スペシャル' },
      { value: 'kato_sodebisha', label: '加藤流袖飛車' },
      { value: 'fujii_system', label: '藤井システム' },
      { value: 'tateishi_ryu', label: '立石流' },
      { value: 'masuda_ishida', label: '升田式石田流' },
      { value: 'nakata_ko_xp', label: '中田功XP' },
      { value: 'manabe_ryu', label: '真部流' },
      { value: 'sugai_sankenbisha', label: '菅井流三間飛車' },
      { value: 'maruyama_vaccine', label: '丸山ワクチン' },
    ],
  },
  {
    category: 'YouTuber戦法',
    tags: [
      { value: 'shodan_system', label: 'ショーダンシステム' },
      { value: 'shodan_original', label: 'ショーダンオリジナル' },
      { value: 'henachoko_kyusen', label: 'へなちょこ急戦' },
      { value: 'henachoko_jikyusen', label: 'へなちょこ持久戦' },
    ],
  },
] ;

export const AVAILABLE_TAGS = TAG_CATEGORIES.flatMap((g) => g.tags);

export const DEFAULT_PROMPT = '手の広い中終盤戦';
