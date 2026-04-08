// Emoji utility: convert Unicode emojis to Apple CDN images + emoji search

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64';

/**
 * Convert a Unicode emoji string to its "unified" hex representation.
 * e.g. "😀" → "1f600", "👨‍👩‍👧" → "1f468-200d-1f469-200d-1f467"
 */
function unicodeToUnified(emoji: string): string {
  const codepoints: string[] = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    if (cp !== undefined) {
      codepoints.push(cp.toString(16));
    }
  }
  return codepoints.join('-');
}

/**
 * Get the CDN image URL for a Unicode emoji.
 */
export function emojiToImgUrl(emoji: string): string {
  return `${CDN_BASE}/${unicodeToUnified(emoji)}.png`;
}

/**
 * Create an <img> HTML tag for a Unicode emoji.
 */
function emojiToImgHtml(emoji: string, size = 20): string {
  const url = emojiToImgUrl(emoji);
  const escapedAlt = emoji.replace(/"/g, '&quot;');
  return `<img src="${url}" alt="${escapedAlt}" style="display:inline-block;vertical-align:text-bottom;width:${size}px;height:${size}px" loading="lazy" draggable="false" />`;
}

// Unicode emoji regex - matches compound emojis (ZWJ sequences, skin tones, flags, keycaps)
// Order matters: longest sequences first
const EMOJI_REGEX = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*(?:\uD83C[\uDFFB-\uDFFF])?|[\u{1F1E0}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/gu;

/**
 * Check if a string contains only emoji characters (with optional whitespace).
 * Used to render emoji-only messages at a larger size.
 */
export function isEmojiOnly(text: string): boolean {
  if (!text || text.length > 30) return false; // fast-path for long messages
  const stripped = text.replace(EMOJI_REGEX, '').replace(/\s/g, '');
  return stripped.length === 0 && EMOJI_REGEX.test(text);
}

/**
 * Replace Unicode emojis in an HTML string with <img> tags.
 * Skips content inside HTML tags (attributes, tag names).
 */
export function renderUnicodeEmojis(html: string, size = 20): string {
  // Split into "inside tags" and "outside tags" segments
  return html.replace(
    /(<[^>]*>)|(?:(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*(?:\uD83C[\uDFFB-\uDFFF])?|[\u{1F1E0}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3)/gu,
    (match, tag) => {
      if (tag) return tag; // Inside an HTML tag, don't replace
      return emojiToImgHtml(match, size);
    },
  );
}

// ─── Emoji Search Data ─────────────────────────────────────────────────────

export interface EmojiEntry {
  name: string;
  emoji: string;
  keywords?: string[];
}

// Compact emoji dataset - common emojis with shortcode names
// This is a curated list covering the most-used emojis
export const EMOJI_DATA: EmojiEntry[] = [
  // Smileys
  { name: 'grinning', emoji: '😀', keywords: ['smile', 'happy'] },
  { name: 'smiley', emoji: '😃', keywords: ['happy', 'joy'] },
  { name: 'smile', emoji: '😄', keywords: ['happy', 'joy'] },
  { name: 'grin', emoji: '😁', keywords: ['happy'] },
  { name: 'laughing', emoji: '😆', keywords: ['happy', 'haha'] },
  { name: 'sweat_smile', emoji: '😅', keywords: ['hot'] },
  { name: 'rofl', emoji: '🤣', keywords: ['lol', 'laughing'] },
  { name: 'joy', emoji: '😂', keywords: ['tears', 'laugh', 'lol'] },
  { name: 'slightly_smiling_face', emoji: '🙂', keywords: ['smile'] },
  { name: 'upside_down_face', emoji: '🙃', keywords: ['silly'] },
  { name: 'wink', emoji: '😉', keywords: ['flirt'] },
  { name: 'blush', emoji: '😊', keywords: ['proud', 'shy'] },
  { name: 'innocent', emoji: '😇', keywords: ['angel'] },
  { name: 'heart_eyes', emoji: '😍', keywords: ['love', 'crush'] },
  { name: 'star_struck', emoji: '🤩', keywords: ['excited'] },
  { name: 'kissing_heart', emoji: '😘', keywords: ['love', 'kiss'] },
  { name: 'kissing', emoji: '😗', keywords: ['kiss'] },
  { name: 'kissing_smiling_eyes', emoji: '😙', keywords: ['kiss'] },
  { name: 'kissing_closed_eyes', emoji: '😚', keywords: ['kiss'] },
  { name: 'yum', emoji: '😋', keywords: ['tongue', 'delicious'] },
  { name: 'stuck_out_tongue', emoji: '😛', keywords: ['playful'] },
  { name: 'stuck_out_tongue_winking_eye', emoji: '😜', keywords: ['playful', 'joke'] },
  { name: 'stuck_out_tongue_closed_eyes', emoji: '😝', keywords: ['playful'] },
  { name: 'money_mouth_face', emoji: '🤑', keywords: ['rich', 'money'] },
  { name: 'hugs', emoji: '🤗', keywords: ['hug'] },
  { name: 'thinking', emoji: '🤔', keywords: ['hmm', 'wonder'] },
  { name: 'zipper_mouth_face', emoji: '🤐', keywords: ['secret', 'quiet'] },
  { name: 'raised_eyebrow', emoji: '🤨', keywords: ['suspicious'] },
  { name: 'neutral_face', emoji: '😐', keywords: ['meh'] },
  { name: 'expressionless', emoji: '😑', keywords: ['blank'] },
  { name: 'no_mouth', emoji: '😶', keywords: ['silent', 'speechless'] },
  { name: 'smirk', emoji: '😏', keywords: ['smug'] },
  { name: 'unamused', emoji: '😒', keywords: ['bored'] },
  { name: 'roll_eyes', emoji: '🙄', keywords: ['annoyed'] },
  { name: 'grimacing', emoji: '😬', keywords: ['awkward'] },
  { name: 'lying_face', emoji: '🤥', keywords: ['liar', 'pinocchio'] },
  { name: 'relieved', emoji: '😌', keywords: ['calm', 'relaxed'] },
  { name: 'pensive', emoji: '😔', keywords: ['sad', 'thoughtful'] },
  { name: 'sleepy', emoji: '😪', keywords: ['tired'] },
  { name: 'drooling_face', emoji: '🤤', keywords: ['want'] },
  { name: 'sleeping', emoji: '😴', keywords: ['zzz', 'tired'] },
  { name: 'mask', emoji: '😷', keywords: ['sick', 'ill'] },
  { name: 'face_with_thermometer', emoji: '🤒', keywords: ['sick', 'fever'] },
  { name: 'face_with_head_bandage', emoji: '🤕', keywords: ['hurt', 'injury'] },
  { name: 'nauseated_face', emoji: '🤢', keywords: ['sick', 'vomit'] },
  { name: 'sneezing_face', emoji: '🤧', keywords: ['cold', 'sick'] },
  { name: 'hot_face', emoji: '🥵', keywords: ['warm', 'sweating'] },
  { name: 'cold_face', emoji: '🥶', keywords: ['freezing'] },
  { name: 'woozy_face', emoji: '🥴', keywords: ['drunk', 'dizzy'] },
  { name: 'dizzy_face', emoji: '😵', keywords: ['unconscious'] },
  { name: 'exploding_head', emoji: '🤯', keywords: ['mind_blown', 'shocked'] },
  { name: 'cowboy_hat_face', emoji: '🤠', keywords: ['cowboy'] },
  { name: 'partying_face', emoji: '🥳', keywords: ['party', 'celebrate'] },
  { name: 'disguised_face', emoji: '🥸', keywords: ['incognito'] },
  { name: 'sunglasses', emoji: '😎', keywords: ['cool'] },
  { name: 'nerd_face', emoji: '🤓', keywords: ['geek'] },
  { name: 'monocle_face', emoji: '🧐', keywords: ['curious'] },
  { name: 'confused', emoji: '😕', keywords: ['puzzled'] },
  { name: 'worried', emoji: '😟', keywords: ['anxious'] },
  { name: 'slightly_frowning_face', emoji: '🙁', keywords: ['sad'] },
  { name: 'frowning_face', emoji: '☹️', keywords: ['sad'] },
  { name: 'open_mouth', emoji: '😮', keywords: ['surprised', 'wow'] },
  { name: 'hushed', emoji: '😯', keywords: ['surprised'] },
  { name: 'astonished', emoji: '😲', keywords: ['shocked'] },
  { name: 'flushed', emoji: '😳', keywords: ['embarrassed'] },
  { name: 'pleading_face', emoji: '🥺', keywords: ['puppy_eyes', 'please'] },
  { name: 'crying_face', emoji: '😢', keywords: ['sad', 'tear'] },
  { name: 'sob', emoji: '😭', keywords: ['crying', 'sad'] },
  { name: 'scream', emoji: '😱', keywords: ['scared', 'horror'] },
  { name: 'confounded', emoji: '😖', keywords: ['upset'] },
  { name: 'persevere', emoji: '😣', keywords: ['struggle'] },
  { name: 'disappointed', emoji: '😞', keywords: ['sad'] },
  { name: 'sweat', emoji: '😓', keywords: ['nervous'] },
  { name: 'weary', emoji: '😩', keywords: ['tired'] },
  { name: 'tired_face', emoji: '😫', keywords: ['exhausted'] },
  { name: 'yawning_face', emoji: '🥱', keywords: ['bored', 'sleepy'] },
  { name: 'angry', emoji: '😠', keywords: ['mad'] },
  { name: 'rage', emoji: '😡', keywords: ['furious', 'angry'] },
  { name: 'cursing_face', emoji: '🤬', keywords: ['swearing'] },
  { name: 'smiling_imp', emoji: '😈', keywords: ['devil'] },
  { name: 'imp', emoji: '👿', keywords: ['devil', 'angry'] },
  { name: 'skull', emoji: '💀', keywords: ['dead', 'death'] },
  { name: 'skull_and_crossbones', emoji: '☠️', keywords: ['death'] },
  { name: 'clown_face', emoji: '🤡', keywords: ['clown'] },
  { name: 'japanese_ogre', emoji: '👹', keywords: ['monster'] },
  { name: 'ghost', emoji: '👻', keywords: ['halloween', 'spooky'] },
  { name: 'alien', emoji: '👽', keywords: ['ufo', 'space'] },
  { name: 'robot', emoji: '🤖', keywords: ['bot'] },
  { name: 'poop', emoji: '💩', keywords: ['shit'] },

  // Gestures & body
  { name: 'wave', emoji: '👋', keywords: ['hello', 'bye'] },
  { name: 'raised_back_of_hand', emoji: '🤚', keywords: ['stop'] },
  { name: 'hand', emoji: '✋', keywords: ['stop', 'high_five'] },
  { name: 'vulcan_salute', emoji: '🖖', keywords: ['spock'] },
  { name: 'ok_hand', emoji: '👌', keywords: ['perfect', 'okay'] },
  { name: 'pinching_hand', emoji: '🤏', keywords: ['small', 'tiny'] },
  { name: 'v', emoji: '✌️', keywords: ['peace', 'victory'] },
  { name: 'crossed_fingers', emoji: '🤞', keywords: ['luck', 'hope'] },
  { name: 'love_you_gesture', emoji: '🤟', keywords: ['love'] },
  { name: 'metal', emoji: '🤘', keywords: ['rock'] },
  { name: 'call_me_hand', emoji: '🤙', keywords: ['phone'] },
  { name: 'point_left', emoji: '👈', keywords: ['left'] },
  { name: 'point_right', emoji: '👉', keywords: ['right'] },
  { name: 'point_up_2', emoji: '👆', keywords: ['up'] },
  { name: 'middle_finger', emoji: '🖕', keywords: ['fu'] },
  { name: 'point_down', emoji: '👇', keywords: ['down'] },
  { name: 'point_up', emoji: '☝️', keywords: ['up'] },
  { name: 'thumbsup', emoji: '👍', keywords: ['+1', 'like', 'yes', 'approve'] },
  { name: 'thumbsdown', emoji: '👎', keywords: ['-1', 'dislike', 'no'] },
  { name: 'fist', emoji: '✊', keywords: ['power', 'punch'] },
  { name: 'facepunch', emoji: '👊', keywords: ['punch'] },
  { name: 'left_facing_fist', emoji: '🤛', keywords: ['fist_bump'] },
  { name: 'right_facing_fist', emoji: '🤜', keywords: ['fist_bump'] },
  { name: 'clap', emoji: '👏', keywords: ['applause', 'bravo'] },
  { name: 'raised_hands', emoji: '🙌', keywords: ['hooray', 'celebrate'] },
  { name: 'open_hands', emoji: '👐', keywords: ['jazz_hands'] },
  { name: 'palms_up_together', emoji: '🤲', keywords: ['prayer'] },
  { name: 'handshake', emoji: '🤝', keywords: ['deal', 'agreement'] },
  { name: 'pray', emoji: '🙏', keywords: ['please', 'thanks', 'hope'] },
  { name: 'writing_hand', emoji: '✍️', keywords: ['write'] },
  { name: 'nail_care', emoji: '💅', keywords: ['beauty', 'nails'] },
  { name: 'muscle', emoji: '💪', keywords: ['strong', 'flex', 'bicep'] },
  { name: 'leg', emoji: '🦵', keywords: ['kick'] },
  { name: 'foot', emoji: '🦶', keywords: ['stomp'] },
  { name: 'ear', emoji: '👂', keywords: ['listen', 'hear'] },
  { name: 'nose', emoji: '👃', keywords: ['smell'] },
  { name: 'brain', emoji: '🧠', keywords: ['smart', 'think'] },
  { name: 'eyes', emoji: '👀', keywords: ['look', 'see', 'watch'] },
  { name: 'eye', emoji: '👁️', keywords: ['see'] },
  { name: 'tongue', emoji: '👅', keywords: ['taste', 'lick'] },
  { name: 'lips', emoji: '👄', keywords: ['kiss', 'mouth'] },

  // Hearts & love
  { name: 'heart', emoji: '❤️', keywords: ['love', 'red'] },
  { name: 'orange_heart', emoji: '🧡', keywords: ['love'] },
  { name: 'yellow_heart', emoji: '💛', keywords: ['love'] },
  { name: 'green_heart', emoji: '💚', keywords: ['love'] },
  { name: 'blue_heart', emoji: '💙', keywords: ['love'] },
  { name: 'purple_heart', emoji: '💜', keywords: ['love'] },
  { name: 'black_heart', emoji: '🖤', keywords: ['love'] },
  { name: 'brown_heart', emoji: '🤎', keywords: ['love'] },
  { name: 'white_heart', emoji: '🤍', keywords: ['love'] },
  { name: 'broken_heart', emoji: '💔', keywords: ['sad'] },
  { name: 'heartpulse', emoji: '💗', keywords: ['love'] },
  { name: 'heartbeat', emoji: '💓', keywords: ['love'] },
  { name: 'two_hearts', emoji: '💕', keywords: ['love'] },
  { name: 'sparkling_heart', emoji: '💖', keywords: ['love'] },
  { name: 'revolving_hearts', emoji: '💞', keywords: ['love'] },
  { name: 'cupid', emoji: '💘', keywords: ['love', 'arrow'] },
  { name: 'gift_heart', emoji: '💝', keywords: ['love'] },
  { name: 'heart_decoration', emoji: '💟', keywords: ['love'] },
  { name: 'heart_exclamation', emoji: '❣️', keywords: ['love'] },
  { name: 'fire', emoji: '🔥', keywords: ['hot', 'flame', 'lit'] },
  { name: 'hundred', emoji: '💯', keywords: ['100', 'perfect', 'score'] },
  { name: 'sparkles', emoji: '✨', keywords: ['shine', 'magic', 'new'] },
  { name: 'star', emoji: '⭐', keywords: ['favorite'] },
  { name: 'star2', emoji: '🌟', keywords: ['glowing'] },
  { name: 'zap', emoji: '⚡', keywords: ['lightning', 'fast'] },
  { name: 'boom', emoji: '💥', keywords: ['explosion'] },
  { name: 'collision', emoji: '💥', keywords: ['explosion', 'bang'] },
  { name: 'sweat_drops', emoji: '💦', keywords: ['water'] },
  { name: 'dash', emoji: '💨', keywords: ['wind', 'fast'] },
  { name: 'rainbow', emoji: '🌈', keywords: ['pride'] },
  { name: 'sun', emoji: '☀️', keywords: ['bright', 'weather'] },
  { name: 'moon', emoji: '🌙', keywords: ['night'] },
  { name: 'cloud', emoji: '☁️', keywords: ['weather'] },
  { name: 'snowflake', emoji: '❄️', keywords: ['cold', 'winter'] },
  { name: 'umbrella', emoji: '☂️', keywords: ['rain'] },

  // Animals
  { name: 'dog', emoji: '🐶', keywords: ['puppy', 'pet'] },
  { name: 'cat', emoji: '🐱', keywords: ['kitten', 'pet'] },
  { name: 'mouse', emoji: '🐭', keywords: ['rodent'] },
  { name: 'hamster', emoji: '🐹', keywords: ['pet'] },
  { name: 'rabbit', emoji: '🐰', keywords: ['bunny'] },
  { name: 'fox', emoji: '🦊', keywords: ['clever'] },
  { name: 'bear', emoji: '🐻', keywords: ['teddy'] },
  { name: 'panda', emoji: '🐼', keywords: ['cute'] },
  { name: 'koala', emoji: '🐨', keywords: ['australia'] },
  { name: 'tiger', emoji: '🐯', keywords: ['rawr'] },
  { name: 'lion', emoji: '🦁', keywords: ['king'] },
  { name: 'cow', emoji: '🐮', keywords: ['moo'] },
  { name: 'pig', emoji: '🐷', keywords: ['oink'] },
  { name: 'frog', emoji: '🐸', keywords: ['ribbit'] },
  { name: 'monkey_face', emoji: '🐵', keywords: ['ape'] },
  { name: 'see_no_evil', emoji: '🙈', keywords: ['monkey', 'shy'] },
  { name: 'hear_no_evil', emoji: '🙉', keywords: ['monkey'] },
  { name: 'speak_no_evil', emoji: '🙊', keywords: ['monkey', 'secret'] },
  { name: 'chicken', emoji: '🐔', keywords: ['bird'] },
  { name: 'penguin', emoji: '🐧', keywords: ['bird', 'cold'] },
  { name: 'bird', emoji: '🐦', keywords: ['tweet'] },
  { name: 'eagle', emoji: '🦅', keywords: ['bird'] },
  { name: 'duck', emoji: '🦆', keywords: ['quack'] },
  { name: 'owl', emoji: '🦉', keywords: ['wise'] },
  { name: 'bat', emoji: '🦇', keywords: ['vampire'] },
  { name: 'wolf', emoji: '🐺', keywords: ['howl'] },
  { name: 'horse', emoji: '🐴', keywords: ['pony'] },
  { name: 'unicorn', emoji: '🦄', keywords: ['magic', 'fantasy'] },
  { name: 'bee', emoji: '🐝', keywords: ['honey', 'buzz'] },
  { name: 'bug', emoji: '🐛', keywords: ['insect'] },
  { name: 'butterfly', emoji: '🦋', keywords: ['pretty'] },
  { name: 'snail', emoji: '🐌', keywords: ['slow'] },
  { name: 'turtle', emoji: '🐢', keywords: ['slow'] },
  { name: 'snake', emoji: '🐍', keywords: ['hiss'] },
  { name: 'octopus', emoji: '🐙', keywords: ['tentacle'] },
  { name: 'whale', emoji: '🐳', keywords: ['ocean'] },
  { name: 'dolphin', emoji: '🐬', keywords: ['flipper'] },
  { name: 'fish', emoji: '🐟', keywords: ['swim'] },
  { name: 'shark', emoji: '🦈', keywords: ['jaws'] },
  { name: 'crab', emoji: '🦀', keywords: ['cancer'] },
  { name: 'shrimp', emoji: '🦐', keywords: ['prawn'] },

  // Food & drink
  { name: 'apple', emoji: '🍎', keywords: ['fruit', 'red'] },
  { name: 'green_apple', emoji: '🍏', keywords: ['fruit'] },
  { name: 'banana', emoji: '🍌', keywords: ['fruit'] },
  { name: 'grapes', emoji: '🍇', keywords: ['fruit', 'wine'] },
  { name: 'watermelon', emoji: '🍉', keywords: ['fruit', 'summer'] },
  { name: 'strawberry', emoji: '🍓', keywords: ['fruit', 'berry'] },
  { name: 'peach', emoji: '🍑', keywords: ['fruit', 'butt'] },
  { name: 'cherry', emoji: '🍒', keywords: ['fruit'] },
  { name: 'lemon', emoji: '🍋', keywords: ['fruit', 'sour'] },
  { name: 'avocado', emoji: '🥑', keywords: ['guacamole'] },
  { name: 'tomato', emoji: '🍅', keywords: ['vegetable'] },
  { name: 'eggplant', emoji: '🍆', keywords: ['aubergine'] },
  { name: 'corn', emoji: '🌽', keywords: ['maize'] },
  { name: 'hot_pepper', emoji: '🌶️', keywords: ['spicy'] },
  { name: 'pizza', emoji: '🍕', keywords: ['food'] },
  { name: 'hamburger', emoji: '🍔', keywords: ['food', 'burger'] },
  { name: 'fries', emoji: '🍟', keywords: ['food', 'chips'] },
  { name: 'hotdog', emoji: '🌭', keywords: ['food'] },
  { name: 'taco', emoji: '🌮', keywords: ['food', 'mexican'] },
  { name: 'burrito', emoji: '🌯', keywords: ['food', 'wrap'] },
  { name: 'sandwich', emoji: '🥪', keywords: ['food'] },
  { name: 'egg', emoji: '🥚', keywords: ['food'] },
  { name: 'cooking', emoji: '🍳', keywords: ['food', 'egg', 'frying'] },
  { name: 'spaghetti', emoji: '🍝', keywords: ['food', 'pasta'] },
  { name: 'ramen', emoji: '🍜', keywords: ['food', 'noodles'] },
  { name: 'sushi', emoji: '🍣', keywords: ['food', 'japanese'] },
  { name: 'rice', emoji: '🍚', keywords: ['food'] },
  { name: 'cake', emoji: '🎂', keywords: ['birthday', 'dessert'] },
  { name: 'cupcake', emoji: '🧁', keywords: ['dessert'] },
  { name: 'cookie', emoji: '🍪', keywords: ['dessert', 'snack'] },
  { name: 'chocolate_bar', emoji: '🍫', keywords: ['dessert', 'candy'] },
  { name: 'candy', emoji: '🍬', keywords: ['sweet'] },
  { name: 'lollipop', emoji: '🍭', keywords: ['sweet', 'candy'] },
  { name: 'ice_cream', emoji: '🍦', keywords: ['dessert'] },
  { name: 'donut', emoji: '🍩', keywords: ['dessert'] },
  { name: 'coffee', emoji: '☕', keywords: ['drink', 'cafe'] },
  { name: 'tea', emoji: '🍵', keywords: ['drink', 'green'] },
  { name: 'beer', emoji: '🍺', keywords: ['drink', 'bar'] },
  { name: 'beers', emoji: '🍻', keywords: ['drink', 'cheers'] },
  { name: 'wine_glass', emoji: '🍷', keywords: ['drink', 'red'] },
  { name: 'cocktail', emoji: '🍸', keywords: ['drink', 'martini'] },
  { name: 'tropical_drink', emoji: '🍹', keywords: ['drink', 'summer'] },
  { name: 'champagne', emoji: '🍾', keywords: ['drink', 'celebrate'] },
  { name: 'milk_glass', emoji: '🥛', keywords: ['drink'] },
  { name: 'baby_bottle', emoji: '🍼', keywords: ['drink'] },

  // Activities & sports
  { name: 'soccer', emoji: '⚽', keywords: ['sport', 'football'] },
  { name: 'basketball', emoji: '🏀', keywords: ['sport'] },
  { name: 'football', emoji: '🏈', keywords: ['sport', 'american'] },
  { name: 'baseball', emoji: '⚾', keywords: ['sport'] },
  { name: 'tennis', emoji: '🎾', keywords: ['sport'] },
  { name: 'volleyball', emoji: '🏐', keywords: ['sport'] },
  { name: 'rugby_football', emoji: '🏉', keywords: ['sport'] },
  { name: 'golf', emoji: '⛳', keywords: ['sport'] },
  { name: 'trophy', emoji: '🏆', keywords: ['win', 'award'] },
  { name: 'medal', emoji: '🏅', keywords: ['win', 'award'] },
  { name: 'video_game', emoji: '🎮', keywords: ['gaming', 'controller'] },
  { name: 'joystick', emoji: '🕹️', keywords: ['gaming'] },
  { name: 'dart', emoji: '🎯', keywords: ['target', 'bullseye'] },
  { name: 'bowling', emoji: '🎳', keywords: ['sport'] },
  { name: 'die', emoji: '🎲', keywords: ['dice', 'game'] },
  { name: 'chess_pawn', emoji: '♟️', keywords: ['game'] },
  { name: 'performing_arts', emoji: '🎭', keywords: ['theater', 'drama'] },
  { name: 'art', emoji: '🎨', keywords: ['painting', 'creative'] },
  { name: 'musical_note', emoji: '🎵', keywords: ['music', 'song'] },
  { name: 'notes', emoji: '🎶', keywords: ['music', 'melody'] },
  { name: 'guitar', emoji: '🎸', keywords: ['music', 'rock'] },
  { name: 'microphone', emoji: '🎤', keywords: ['sing', 'karaoke'] },
  { name: 'headphones', emoji: '🎧', keywords: ['music', 'listen'] },
  { name: 'drum', emoji: '🥁', keywords: ['music', 'beat'] },

  // Objects
  { name: 'computer', emoji: '💻', keywords: ['laptop', 'tech'] },
  { name: 'desktop_computer', emoji: '🖥️', keywords: ['pc'] },
  { name: 'keyboard', emoji: '⌨️', keywords: ['type'] },
  { name: 'phone', emoji: '📱', keywords: ['mobile', 'cell'] },
  { name: 'telephone', emoji: '☎️', keywords: ['call'] },
  { name: 'camera', emoji: '📷', keywords: ['photo'] },
  { name: 'tv', emoji: '📺', keywords: ['television'] },
  { name: 'bulb', emoji: '💡', keywords: ['idea', 'light'] },
  { name: 'flashlight', emoji: '🔦', keywords: ['light'] },
  { name: 'battery', emoji: '🔋', keywords: ['power'] },
  { name: 'money_with_wings', emoji: '💸', keywords: ['cash', 'spend'] },
  { name: 'dollar', emoji: '💵', keywords: ['money', 'cash'] },
  { name: 'gem', emoji: '💎', keywords: ['diamond', 'precious'] },
  { name: 'wrench', emoji: '🔧', keywords: ['tool', 'fix'] },
  { name: 'hammer', emoji: '🔨', keywords: ['tool', 'build'] },
  { name: 'gear', emoji: '⚙️', keywords: ['settings', 'config'] },
  { name: 'link', emoji: '🔗', keywords: ['chain', 'url'] },
  { name: 'lock', emoji: '🔒', keywords: ['secure', 'password'] },
  { name: 'unlock', emoji: '🔓', keywords: ['open'] },
  { name: 'key', emoji: '🔑', keywords: ['password'] },
  { name: 'bell', emoji: '🔔', keywords: ['notification', 'alarm'] },
  { name: 'no_bell', emoji: '🔕', keywords: ['mute'] },
  { name: 'bookmark', emoji: '🔖', keywords: ['save'] },
  { name: 'book', emoji: '📖', keywords: ['read'] },
  { name: 'books', emoji: '📚', keywords: ['read', 'library'] },
  { name: 'envelope', emoji: '✉️', keywords: ['mail', 'email'] },
  { name: 'memo', emoji: '📝', keywords: ['note', 'write'] },
  { name: 'pencil2', emoji: '✏️', keywords: ['write'] },
  { name: 'paperclip', emoji: '📎', keywords: ['attachment'] },
  { name: 'pushpin', emoji: '📌', keywords: ['pin', 'location'] },
  { name: 'scissors', emoji: '✂️', keywords: ['cut'] },
  { name: 'wastebasket', emoji: '🗑️', keywords: ['trash', 'delete'] },
  { name: 'package', emoji: '📦', keywords: ['box', 'deliver'] },
  { name: 'rocket', emoji: '🚀', keywords: ['launch', 'fast', 'space'] },
  { name: 'airplane', emoji: '✈️', keywords: ['travel', 'flight'] },
  { name: 'car', emoji: '🚗', keywords: ['drive', 'vehicle'] },
  { name: 'taxi', emoji: '🚕', keywords: ['vehicle'] },
  { name: 'bus', emoji: '🚌', keywords: ['vehicle', 'transit'] },
  { name: 'train', emoji: '🚆', keywords: ['vehicle', 'transit'] },
  { name: 'bike', emoji: '🚲', keywords: ['bicycle', 'ride'] },
  { name: 'ship', emoji: '🚢', keywords: ['boat', 'cruise'] },

  // Symbols
  { name: 'check', emoji: '✅', keywords: ['yes', 'done', 'complete'] },
  { name: 'x', emoji: '❌', keywords: ['no', 'wrong', 'delete'] },
  { name: 'warning', emoji: '⚠️', keywords: ['alert', 'caution'] },
  { name: 'no_entry', emoji: '⛔', keywords: ['stop', 'forbidden'] },
  { name: 'question', emoji: '❓', keywords: ['what', 'help'] },
  { name: 'exclamation', emoji: '❗', keywords: ['bang', 'alert'] },
  { name: 'plus', emoji: '➕', keywords: ['add'] },
  { name: 'minus', emoji: '➖', keywords: ['subtract'] },
  { name: 'arrow_right', emoji: '➡️', keywords: ['next'] },
  { name: 'arrow_left', emoji: '⬅️', keywords: ['previous', 'back'] },
  { name: 'arrow_up', emoji: '⬆️', keywords: ['up'] },
  { name: 'arrow_down', emoji: '⬇️', keywords: ['down'] },
  { name: 'recycle', emoji: '♻️', keywords: ['green', 'environment'] },
  { name: 'infinity', emoji: '♾️', keywords: ['forever'] },
  { name: 'peace', emoji: '☮️', keywords: ['hippie'] },
  { name: 'yin_yang', emoji: '☯️', keywords: ['balance'] },

  // Flags & misc
  { name: 'flag_white', emoji: '🏳️', keywords: ['surrender'] },
  { name: 'flag_black', emoji: '🏴', keywords: ['pirate'] },
  { name: 'checkered_flag', emoji: '🏁', keywords: ['race', 'finish'] },
  { name: 'triangular_flag', emoji: '🚩', keywords: ['red_flag', 'warning'] },

  // Celebration
  { name: 'tada', emoji: '🎉', keywords: ['party', 'celebrate', 'hooray'] },
  { name: 'confetti_ball', emoji: '🎊', keywords: ['party', 'celebrate'] },
  { name: 'balloon', emoji: '🎈', keywords: ['party'] },
  { name: 'gift', emoji: '🎁', keywords: ['present', 'birthday'] },
  { name: 'ribbon', emoji: '🎀', keywords: ['bow', 'decoration'] },
  { name: 'crown', emoji: '👑', keywords: ['king', 'queen', 'royal'] },
  { name: 'ring', emoji: '💍', keywords: ['wedding', 'marriage'] },
  { name: 'crystal_ball', emoji: '🔮', keywords: ['magic', 'fortune'] },

  // Nature & weather
  { name: 'rose', emoji: '🌹', keywords: ['flower', 'love'] },
  { name: 'sunflower', emoji: '🌻', keywords: ['flower'] },
  { name: 'blossom', emoji: '🌼', keywords: ['flower'] },
  { name: 'tulip', emoji: '🌷', keywords: ['flower'] },
  { name: 'cactus', emoji: '🌵', keywords: ['desert'] },
  { name: 'christmas_tree', emoji: '🎄', keywords: ['holiday'] },
  { name: 'palm_tree', emoji: '🌴', keywords: ['tropical'] },
  { name: 'fallen_leaf', emoji: '🍂', keywords: ['autumn'] },
  { name: 'maple_leaf', emoji: '🍁', keywords: ['canada', 'autumn'] },
  { name: 'four_leaf_clover', emoji: '🍀', keywords: ['luck', 'irish'] },
  { name: 'mushroom', emoji: '🍄', keywords: ['toadstool'] },
  { name: 'earth_americas', emoji: '🌎', keywords: ['world', 'globe'] },
  { name: 'globe_with_meridians', emoji: '🌐', keywords: ['world', 'internet'] },
  { name: 'full_moon', emoji: '🌕', keywords: ['night'] },
  { name: 'new_moon', emoji: '🌑', keywords: ['night'] },
  { name: 'crescent_moon', emoji: '🌙', keywords: ['night'] },
  { name: 'comet', emoji: '☄️', keywords: ['space'] },
];

/**
 * Search emojis by name or keywords.
 */
export function searchEmojis(query: string, limit = 8): EmojiEntry[] {
  if (!query) return [];
  const q = query.toLowerCase();
  const results: EmojiEntry[] = [];

  // First pass: name starts with query (highest priority)
  for (const entry of EMOJI_DATA) {
    if (results.length >= limit) break;
    if (entry.name.startsWith(q)) {
      results.push(entry);
    }
  }

  // Second pass: name contains query
  if (results.length < limit) {
    for (const entry of EMOJI_DATA) {
      if (results.length >= limit) break;
      if (results.includes(entry)) continue;
      if (entry.name.includes(q)) {
        results.push(entry);
      }
    }
  }

  // Third pass: keyword match
  if (results.length < limit) {
    for (const entry of EMOJI_DATA) {
      if (results.length >= limit) break;
      if (results.includes(entry)) continue;
      if (entry.keywords?.some((kw) => kw.includes(q))) {
        results.push(entry);
      }
    }
  }

  return results;
}
