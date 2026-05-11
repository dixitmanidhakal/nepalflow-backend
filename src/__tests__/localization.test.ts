/**
 * Tests: Localization switching
 */

type TranslationDict = Record<string, string>;

const en: TranslationDict = {
  schedule_post: 'Schedule Post',
  inbox: 'Inbox',
  analytics: 'Analytics',
  dashboard: 'Dashboard',
  connect_account: 'Connect Account',
  welcome: 'Welcome to NepalFlow!',
  post_scheduled: 'Post scheduled successfully',
  no_posts: 'No posts found',
};

const ne: TranslationDict = {
  schedule_post: 'पोस्ट तालिका बनाउनुहोस्',
  inbox: 'इनबक्स',
  analytics: 'विश्लेषण',
  dashboard: 'ड्यासबोर्ड',
  connect_account: 'खाता जोड्नुहोस्',
  welcome: 'NepalFlow मा स्वागत छ!',
  post_scheduled: 'पोस्ट सफलतापूर्वक तालिका बनाइयो',
  no_posts: 'कुनै पोस्ट फेला परेन',
};

function t(key: string, lang = 'en'): string {
  const dict = lang === 'ne' ? ne : en;
  return dict[key] || key;
}

describe('Localization', () => {
  describe('Language switching', () => {
    it('should return English text for "en" locale', () => {
      expect(t('schedule_post', 'en')).toBe('Schedule Post');
      expect(t('inbox', 'en')).toBe('Inbox');
      expect(t('analytics', 'en')).toBe('Analytics');
    });

    it('should return Nepali text for "ne" locale', () => {
      expect(t('schedule_post', 'ne')).toBe('पोस्ट तालिका बनाउनुहोस्');
      expect(t('inbox', 'ne')).toBe('इनबक्स');
      expect(t('analytics', 'ne')).toBe('विश्लेषण');
    });

    it('should fallback to key name for missing translations', () => {
      expect(t('non_existent_key', 'ne')).toBe('non_existent_key');
    });

    it('should handle all core MVP keys in English', () => {
      const coreKeys = ['schedule_post', 'inbox', 'analytics', 'dashboard', 'welcome'];
      coreKeys.forEach(key => {
        expect(t(key, 'en')).not.toBe(key);
      });
    });

    it('should handle all core MVP keys in Nepali', () => {
      const coreKeys = ['schedule_post', 'inbox', 'analytics', 'dashboard', 'welcome'];
      coreKeys.forEach(key => {
        expect(t(key, 'ne')).not.toBe(key);
      });
    });

    it('Nepali text should be valid UTF-8', () => {
      const nepaliText = t('welcome', 'ne');
      const buffer = Buffer.from(nepaliText, 'utf-8');
      expect(buffer.toString('utf-8')).toBe(nepaliText);
    });

    it('should default to English if no lang specified', () => {
      expect(t('inbox')).toBe('Inbox');
    });
  });
});
