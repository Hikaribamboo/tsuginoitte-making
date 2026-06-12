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
    category: "基本戦法",
    tags: [
      { value: "ibisha", label: "居飛車" },
      { value: "furibisha", label: "振り飛車" },
      { value: "aigakari", label: "相掛かり" },
      { value: "kakugawari", label: "角換わり" },
      { value: "yokofudori", label: "横歩取り" },
      { value: "yagura_senpo", label: "矢倉戦法" },
      { value: "gangi_senpo", label: "雁木戦法" },
      { value: "migishiken", label: "右四間飛車" },
      { value: "migi_gyoku_senpo", label: "右玉戦法" },
      { value: "sodebisha", label: "袖飛車" },
      { value: "hineribisha", label: "ひねり飛車" },
      { value: "kakukoukan", label: "角交換振り飛車" },
      { value: "aifuribisha", label: "相振り飛車" }
    ]
  },
  {
    category: "振り飛車",
    tags: [
      { value: "mukaibisha", label: "向飛車" },
      { value: "sanken", label: "三間飛車" },
      { value: "shiken", label: "四間飛車" },
      { value: "nakabisha", label: "中飛車" },
      { value: "ishida_ryu", label: "石田流" },
      { value: "hayashi_ishida", label: "早石田" },
      { value: "gokigen_nakabisha", label: "ゴキゲン中飛車" },
      { value: "tsunogin_nakabisha", label: "ツノ銀中飛車" },
      { value: "kaze_guruma", label: "風車" },
      { value: "yodofuribisha", label: "陽動振り飛車" },
      { value: "kakumichi_tomeru_shiken", label: "ノーマル四間飛車" },
      { value: "kakumichi_tomeru_sanken", label: "ノーマル三間飛車" },
      { value: "mukaibisha_kyusen", label: "向飛車急戦" },
      { value: "shiken_kyusen", label: "四間飛車急戦" },
      { value: "sanken_kyusen", label: "三間飛車急戦" }
    ]
  },
  {
    category: "急戦・攻め筋",
    tags: [
      { value: "bogin", label: "棒銀" },
      { value: "hayaguri_gin", label: "早繰り銀" },
      { value: "koshikake_gin", label: "腰掛け銀" },
      { value: "naname_bogin", label: "斜め棒銀" },
      { value: "bo_kin", label: "棒金" },
      { value: "suzume_zashi", label: "雀刺し" },
      { value: "yonken_bisha_kyusen", label: "4→3戦法" },
      { value: "toriai", label: "取り合い" },
      { value: "hayazashi", label: "早仕掛け" },
      { value: "shiken_vs_bogin", label: "対四間棒銀" },
      { value: "yamada_joseki", label: "山田定跡" },
      { value: "saginomiya_joseki", label: "鷺宮定跡" },
      { value: "elmo_kyusen", label: "エルモ急戦" },
      { value: "migi_shiken_vs_furibisha", label: "右四間対振り飛車" }
    ]
  },
  {
    category: "基本囲い",
    tags: [
      { value: "funagakoi", label: "船囲い" },
      { value: "yagura", label: "矢倉" },
      { value: "gangi", label: "雁木" },
      { value: "hakoirimusume", label: "箱入り娘" },
      { value: "migigyoku", label: "右玉" },
      { value: "hidarigyoku", label: "左玉" },
      { value: "ibisha_millennium", label: "居飛車ミレニアム" },
      { value: "ibisha_anaguma", label: "居飛車穴熊" },
      { value: "kani_gakoi", label: "カニ囲い" },
      { value: "bonanza_gakoi", label: "ボナンザ囲い" },
      { value: "hidari_mino", label: "左美濃" },
      { value: "tenshukaku", label: "天守閣美濃" },
      { value: "mino_gakoi", label: "美濃囲い" },
      { value: "ginkanmuri", label: "銀冠" },
      { value: "kinmusou", label: "金無双" },
      { value: "migi_yagura", label: "右矢倉" },
      { value: "furibisha_millennium", label: "振り飛車ミレニアム" },
      { value: "furibisha_anaguma", label: "振り飛車穴熊" },
      { value: "anaguma", label: "穴熊" }
    ]
  },
  {
    category: "囲い派生",
    tags: [
      { value: "kata_mino", label: "片美濃" },
      { value: "hon_mino", label: "本美濃" },
      { value: "taka_mino", label: "高美濃" },
      { value: "gin_mino", label: "銀美濃" },
      { value: "diamond_mino", label: "ダイヤモンド美濃" },
      { value: "chogo_mino", label: "ちょんまげ美濃" },
      { value: "kin_mino", label: "金美濃" },
      { value: "matsuo_ryu_anaguma", label: "松尾流穴熊" },
      { value: "big_four", label: "ビッグ4" },
      { value: "gin_yagura", label: "銀矢倉" },
      { value: "kin_yagura", label: "金矢倉" },
      { value: "sougakari_yagura", label: "総矢倉" },
      { value: "ryuusen_yagura", label: "流線矢倉" },
      { value: "kabuto_yagura", label: "カブト矢倉" },
      { value: "mujuryoku_yagura", label: "無責任矢倉" },
      { value: "elmo_gakoi", label: "エルモ囲い" },
      { value: "balance_gakoi", label: "バランス囲い" },
      { value: "nakahara_gakoi", label: "中原囲い" },
      { value: "yonenaga_gyoku", label: "米長玉" },
      { value: "mukaitobisha_gakoi", label: "向飛車囲い" }
    ]
  },
  {
    category: "プロ戦法",
    tags: [
      { value: "waki_system", label: "脇システム" },
      { value: "morishita_system", label: "森下システム" },
      { value: "yonenaga_kyusen_yagura", label: "米長流急戦矢倉" },
      { value: "nakahara_kyusen_yagura", label: "中原流急戦矢倉" },
      { value: "akutsu_kyusen_yagura", label: "阿久津流急戦矢倉" },
      { value: "tsukada_special", label: "塚田スペシャル" },
      { value: "kato_sodebisha", label: "加藤流袖飛車" },
      { value: "fujii_system", label: "藤井システム" },
      { value: "tateishi_ryu", label: "立石流" },
      { value: "masuda_ishida", label: "升田式石田流" },
      { value: "nakata_ko_xp", label: "中田功XP" },
      { value: "manabe_ryu", label: "真部流" },
      { value: "sugai_sankenbisha", label: "菅井流三間飛車" },
      { value: "maruyama_vaccine", label: "丸山ワクチン" },
      { value: "kimura_mino", label: "木村美濃" },
      { value: "fujimori_system", label: "藤森システム" },
      { value: "itumon_system", label: "いっつもシステム" },
      { value: "yamasaki_ryu", label: "山崎流" },
      { value: "murayama_jigenryu", label: "村山流" },
      { value: "sato_yasumitsu_ryu", label: "佐藤康光流" },
      { value: "habu_ryu", label: "羽生流" },
      { value: "watanabe_ryu", label: "渡辺流" },
      { value: "fujii_sota_ryu", label: "藤井聡太流" }
    ]
  },
  {
    category: "有名戦型",
    tags: [
      { value: "yagura_vs_yagura", label: "相矢倉" },
      { value: "aigakari_bogin", label: "相掛かり棒銀" },
      { value: "aigakari_hayaguri_gin", label: "相掛かり早繰り銀" },
      { value: "kakugawari_bogin", label: "角換わり棒銀" },
      { value: "kakugawari_hayaguri_gin", label: "角換わり早繰り銀" },
      { value: "kakugawari_koshikake_gin", label: "角換わり腰掛け銀" },
      { value: "yokofudori_45kaku", label: "横歩取り△4五角" },
      { value: "yokofudori_33kaku", label: "横歩取り△3三角" },
      { value: "yokofudori_85tobi", label: "横歩取り△8五飛" },
      { value: "yokofudori_aonoryu", label: "青野流" },
      { value: "yokofudori_yujiro_ryu", label: "勇気流" },
      { value: "yokofudori_takeshi_ryu", label: "竹部流" },
      { value: "shiken_vs_anaguma", label: "四間飛車対穴熊" },
      { value: "shiken_vs_hidari_mino", label: "四間飛車対左美濃" },
      { value: "sanken_vs_anaguma", label: "三間飛車対穴熊" },
      { value: "nakabisha_vs_anaguma", label: "中飛車対穴熊" }
    ]
  },
  {
    category: "奇襲・力戦",
    tags: [
      { value: "ureshino_ryu", label: "嬉野流" },
      { value: "onigoroshi", label: "鬼殺し" },
      { value: "shin_onigoroshi", label: "新鬼殺し" },
      { value: "pakku_man", label: "パックマン戦法" },
      { value: "suji_chigai_kaku", label: "筋違い角" },
      { value: "bando_ryu", label: "阪田流向飛車" },
      { value: "abema_tobi", label: "アヒル戦法" },
      { value: "hissi_bogin", label: "原始棒銀" },
      { value: "hissi_nakabisha", label: "原始中飛車" },
      { value: "hayakuri_kin", label: "早繰り金" },
      { value: "kishu", label: "奇襲戦法" },
      { value: "rikisen", label: "力戦" },
      { value: "aiyagura_rikisen", label: "相矢倉力戦" }
    ]
  },
  {
    category: "YouTuber戦法",
    tags: [
      { value: "shodan_system", label: "ショーダンシステム" },
      { value: "shodan_original", label: "ショーダンオリジナル" },
      { value: "henachoko_kyusen", label: "へなちょこ急戦" },
      { value: "henachoko_jikyusen", label: "へなちょこ持久戦" },
      { value: "abo_system", label: "アボカドシステム" },
      { value: "right_king_youtuber", label: "右玉系YouTuber戦法" },
      { value: "sai_kyusen", label: "サイ急戦" }
    ]
  },
  {
    category: "対局段階",
    tags: [
      { value: "opening", label: "序盤" },
      { value: "middlegame", label: "中盤" },
      { value: "endgame", label: "終盤" }
    ]
  }
];

export const AVAILABLE_TAGS = TAG_CATEGORIES.flatMap((g) => g.tags);

export const DEFAULT_PROMPT = '最善手を選んでください';
