<?php
/**
 * Plugin Name: KATEBLOG Importer
 * Description: GitHubリポジトリから記事HTMLを取得してWordPressに投稿するプラグイン
 * Version: 2.0.0
 * Author: KATEstageLASH
 */

if (!defined('ABSPATH')) exit;

// ========================================
// 自動インポート（WP-Cron）
// ========================================

// Cron スケジュール登録（1時間ごと）
add_filter('cron_schedules', function($schedules) {
    $schedules['kateblog_hourly'] = array(
        'interval' => 3600,
        'display'  => 'KATEBLOG: 1時間ごと',
    );
    return $schedules;
});

// プラグイン有効化時にCronを登録
register_activation_hook(__FILE__, function() {
    if (!wp_next_scheduled('kateblog_auto_import_hook')) {
        wp_schedule_event(time(), 'kateblog_hourly', 'kateblog_auto_import_hook');
    }
});

// プラグイン無効化時にCronを解除
register_deactivation_hook(__FILE__, function() {
    wp_clear_scheduled_hook('kateblog_auto_import_hook');
});

// 自動インポート実行
add_action('kateblog_auto_import_hook', 'kateblog_auto_import');

function kateblog_auto_import() {
    $files = kateblog_fetch_github_files();
    if (isset($files['error']) || empty($files)) return;

    // インポート済みファイルリストを取得
    $imported = get_option('kateblog_imported_files', array());
    $log = array();

    foreach ($files as $file) {
        $filename = $file['name'];

        // 既にインポート済みならスキップ
        if (in_array($filename, $imported)) continue;

        // ブリーフJSONから投稿日を取得
        $slug = str_replace('.html', '', $filename);
        $brief = kateblog_fetch_brief($slug);
        $publish_date = '';
        $publish_time = '11:00';
        if ($brief && !empty($brief['publishDate'])) {
            $publish_date = $brief['publishDate'];
        }
        if ($brief && !empty($brief['publishTime'])) {
            $publish_time = $brief['publishTime'];
        }

        // インポート実行
        $result = kateblog_import_article($file['download_url'], $publish_date, $publish_time);

        if (isset($result['success']) && $result['success']) {
            $imported[] = $filename;
            $log[] = "✅ {$filename} → {$result['title']} (ID:{$result['post_id']}, {$result['status']})";
        } else {
            $log[] = "❌ {$filename} → " . ($result['error'] ?? 'unknown error');
        }
    }

    // インポート済みリストを更新
    update_option('kateblog_imported_files', $imported);

    // ログを保存（管理画面で確認用）
    if (!empty($log)) {
        $existing_log = get_option('kateblog_import_log', array());
        $existing_log[] = array(
            'date' => current_time('Y-m-d H:i:s'),
            'entries' => $log,
        );
        // 最新20回分のみ保持
        if (count($existing_log) > 20) {
            $existing_log = array_slice($existing_log, -20);
        }
        update_option('kateblog_import_log', $existing_log);
    }
}

// GitHubからブリーフJSONを取得
function kateblog_fetch_brief($slug) {
    $repo = get_option('kateblog_github_repo', 'tanukichiyamaguchi/KATEBLOG');
    $branch = get_option('kateblog_github_branch', 'claude/blog-automation-system-YsyOB');
    $token = get_option('kateblog_github_token', '');

    $url = "https://raw.githubusercontent.com/{$repo}/{$branch}/briefs/{$slug}.json";
    $args = array(
        'headers' => array('User-Agent' => 'KATEBLOG-Importer/2.0'),
        'timeout' => 15,
    );
    if ($token) {
        $args['headers']['Authorization'] = "Bearer {$token}";
    }

    $response = wp_remote_get($url, $args);
    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
        return null;
    }

    return json_decode(wp_remote_retrieve_body($response), true);
}

// ========================================
// 管理画面
// ========================================

// 管理画面メニュー追加
add_action('admin_menu', function() {
    add_menu_page(
        'KATEBLOG Importer',
        'KATEBLOG',
        'manage_options',
        'kateblog-importer',
        'kateblog_render_page',
        'dashicons-download',
        30
    );
});

// 設定の登録
add_action('admin_init', function() {
    register_setting('kateblog_settings', 'kateblog_github_repo');
    register_setting('kateblog_settings', 'kateblog_github_branch');
    register_setting('kateblog_settings', 'kateblog_github_token');
});

// メタ情報をHTMLコメントから抽出
function kateblog_extract_meta($html) {
    $meta = array();
    if (preg_match('/<!--\s*TITLE:\s*(.+?)\s*-->/', $html, $m)) $meta['title'] = $m[1];
    if (preg_match('/<!--\s*META:\s*(.+?)\s*-->/', $html, $m)) $meta['description'] = $m[1];
    if (preg_match('/<!--\s*KEYWORD:\s*(.+?)\s*-->/', $html, $m)) $meta['keyword'] = $m[1];
    if (preg_match('/<!--\s*CATEGORY:\s*(\d+)\s*-->/', $html, $m)) $meta['category'] = intval($m[1]);
    if (preg_match('/<!--\s*SLUG:\s*(.+?)\s*-->/', $html, $m)) $meta['slug'] = $m[1];
    return $meta;
}

// メタコメントを本文から除去
function kateblog_strip_meta($html) {
    return trim(preg_replace('/<!--\s*(TITLE|META|KEYWORD|CATEGORY|SLUG):\s*.+?\s*-->\n?/', '', $html));
}

// GitHubからファイル一覧を取得
function kateblog_fetch_github_files() {
    $repo = get_option('kateblog_github_repo', 'tanukichiyamaguchi/KATEBLOG');
    $branch = get_option('kateblog_github_branch', 'claude/blog-automation-system-YsyOB');
    $token = get_option('kateblog_github_token', '');

    $url = "https://api.github.com/repos/{$repo}/contents/output?ref={$branch}";
    $args = array(
        'headers' => array(
            'Accept' => 'application/vnd.github.v3+json',
            'User-Agent' => 'KATEBLOG-Importer/1.0',
        ),
        'timeout' => 30,
    );
    if ($token) {
        $args['headers']['Authorization'] = "Bearer {$token}";
    }

    $response = wp_remote_get($url, $args);
    if (is_wp_error($response)) {
        return array('error' => $response->get_error_message());
    }

    $body = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($body)) {
        return array('error' => 'GitHub APIからの応答が不正です');
    }

    // HTMLファイルのみ
    $files = array();
    foreach ($body as $file) {
        if (isset($file['name']) && preg_match('/\.html$/', $file['name'])) {
            $files[] = array(
                'name' => $file['name'],
                'download_url' => $file['download_url'],
                'sha' => $file['sha'],
            );
        }
    }
    return $files;
}

// GitHubからファイル内容を取得
function kateblog_fetch_file_content($download_url) {
    $token = get_option('kateblog_github_token', '');
    $args = array(
        'headers' => array('User-Agent' => 'KATEBLOG-Importer/1.0'),
        'timeout' => 30,
    );
    if ($token) {
        $args['headers']['Authorization'] = "Bearer {$token}";
    }

    $response = wp_remote_get($download_url, $args);
    if (is_wp_error($response)) return null;
    return wp_remote_retrieve_body($response);
}

// SVG画像を生成（sharpの代替：PHP GD）
function kateblog_generate_image($heading, $article_title) {
    $width = 1200;
    $height = 630;

    // テーマカラー選択
    $colors = kateblog_select_theme($article_title);

    $img = imagecreatetruecolor($width, $height);
    imagesavealpha($img, true);

    // グラデーション背景
    $from = kateblog_hex_to_rgb($colors['from']);
    $to = kateblog_hex_to_rgb($colors['to']);
    for ($x = 0; $x < $width; $x++) {
        $ratio = $x / $width;
        $r = intval($from[0] + ($to[0] - $from[0]) * $ratio);
        $g = intval($from[1] + ($to[1] - $from[1]) * $ratio);
        $b = intval($from[2] + ($to[2] - $from[2]) * $ratio);
        $color = imagecolorallocate($img, $r, $g, $b);
        imageline($img, $x, 0, $x, $height, $color);
    }

    // テキスト描画
    $white = imagecolorallocate($img, 255, 255, 255);
    $font = __DIR__ . '/NotoSansJP-Bold.ttf';

    if (file_exists($font)) {
        // フォントファイルがある場合
        $font_size = 36;
        $lines = kateblog_wrap_text($heading, 16);
        $line_height = 60;
        $total_height = count($lines) * $line_height;
        $start_y = ($height - $total_height) / 2;

        foreach ($lines as $i => $line) {
            $bbox = imagettfbbox($font_size, 0, $font, $line);
            $text_width = $bbox[2] - $bbox[0];
            $x = ($width - $text_width) / 2;
            $y = $start_y + ($i + 1) * $line_height;
            imagettftext($img, $font_size, 0, $x, $y, $white, $font, $line);
        }

        // サロン名
        $salon_size = 18;
        $salon = 'KATEstageLASH蒲田西口店';
        $bbox = imagettfbbox($salon_size, 0, $font, $salon);
        $salon_width = $bbox[2] - $bbox[0];
        imagettftext($img, $salon_size, 0, ($width - $salon_width) / 2, $start_y + $total_height + 80, $white, $font, $salon);
    } else {
        // フォントファイルがない場合は簡易描画
        $text = mb_substr($heading, 0, 30);
        imagestring($img, 5, $width / 2 - strlen($text) * 4, $height / 2 - 10, $text, $white);
    }

    // 一時ファイルに保存
    $tmp = wp_tempnam('kateblog_img_') . '.png';
    imagepng($img, $tmp);
    imagedestroy($img);

    return $tmp;
}

function kateblog_hex_to_rgb($hex) {
    $hex = ltrim($hex, '#');
    return array(
        hexdec(substr($hex, 0, 2)),
        hexdec(substr($hex, 2, 2)),
        hexdec(substr($hex, 4, 2)),
    );
}

function kateblog_select_theme($title) {
    $themes = array(
        array('triggers' => array('まつ毛パーマ', 'パリジェンヌ', 'ラッシュリフト'), 'from' => '#1a1a4e', 'to' => '#6b3fa0'),
        array('triggers' => array('アイブロウ', '眉毛'), 'from' => '#5c3d1e', 'to' => '#c9a84c'),
        array('triggers' => array('まつ毛ケア', '美容液', 'トリートメント'), 'from' => '#d4456b', 'to' => '#e8a0b4'),
        array('triggers' => array('蒲田', '大田区'), 'from' => '#1a7a6d', 'to' => '#4ecdc4'),
    );
    foreach ($themes as $theme) {
        foreach ($theme['triggers'] as $t) {
            if (mb_strpos($title, $t) !== false) {
                return array('from' => $theme['from'], 'to' => $theme['to']);
            }
        }
    }
    return array('from' => '#e07850', 'to' => '#f5c4a1');
}

function kateblog_wrap_text($text, $max) {
    $lines = array();
    $current = '';
    for ($i = 0; $i < mb_strlen($text); $i++) {
        $current .= mb_substr($text, $i, 1);
        if (mb_strlen($current) >= $max) {
            $lines[] = $current;
            $current = '';
        }
    }
    if ($current) $lines[] = $current;
    return $lines;
}

// 画像をWordPressにアップロード
function kateblog_upload_image($image_path, $alt_text) {
    require_once(ABSPATH . 'wp-admin/includes/media.php');
    require_once(ABSPATH . 'wp-admin/includes/file.php');
    require_once(ABSPATH . 'wp-admin/includes/image.php');

    $file_array = array(
        'name' => basename($image_path),
        'tmp_name' => $image_path,
    );

    $attachment_id = media_handle_sideload($file_array, 0);
    if (is_wp_error($attachment_id)) {
        return null;
    }

    update_post_meta($attachment_id, '_wp_attachment_image_alt', $alt_text);
    return $attachment_id;
}

// GitHubから事前生成済み画像をダウンロード
function kateblog_download_github_image($slug, $image_index) {
    $repo = get_option('kateblog_github_repo', 'tanukichiyamaguchi/KATEBLOG');
    $branch = get_option('kateblog_github_branch', 'claude/blog-automation-system-YsyOB');
    $token = get_option('kateblog_github_token', '');

    $url = "https://raw.githubusercontent.com/{$repo}/{$branch}/output/images-{$slug}/image-{$image_index}.png";
    $args = array(
        'headers' => array('User-Agent' => 'KATEBLOG-Importer/1.0'),
        'timeout' => 30,
    );
    if ($token) {
        $args['headers']['Authorization'] = "Bearer {$token}";
    }

    $response = wp_remote_get($url, $args);
    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
        return null;
    }

    $tmp = wp_tempnam('kateblog_img_') . '.png';
    file_put_contents($tmp, wp_remote_retrieve_body($response));
    return $tmp;
}

// 記事をインポート
function kateblog_import_article($download_url, $publish_date = '', $publish_time = '11:00') {
    $html = kateblog_fetch_file_content($download_url);
    if (!$html) return array('error' => 'ファイルの取得に失敗しました');

    $meta = kateblog_extract_meta($html);
    if (empty($meta['title'])) return array('error' => 'タイトルが見つかりません');

    $content = kateblog_strip_meta($html);
    $slug = isset($meta['slug']) ? $meta['slug'] : '';

    // GitHubから事前生成済みの画像をダウンロードして置換
    preg_match_all('/<h2[^>]*>(.*?)<\/h2>/i', $content, $h2_matches);
    $image_index = 1;

    if (!empty($h2_matches[1])) {
        foreach ($h2_matches[1] as $heading) {
            $clean_heading = strip_tags($heading);
            $placeholder = "%%IMAGE_{$image_index}%%";

            if (strpos($content, $placeholder) !== false && $slug) {
                // sharp で生成済みの画像を GitHub からダウンロード（0始まり）
                $tmp_image = kateblog_download_github_image($slug, $image_index - 1);

                if ($tmp_image) {
                    $att_id = kateblog_upload_image($tmp_image, $clean_heading);

                    if ($att_id) {
                        $img_url = wp_get_attachment_url($att_id);
                        $content = str_replace($placeholder, $img_url, $content);

                        if ($image_index === 1) {
                            $featured_image_id = $att_id;
                        }
                    }
                    @unlink($tmp_image);
                }
            }
            $image_index++;
        }
    }

    // 投稿者を「ケイトステージラッシュ」に設定
    $author_id = 0;
    $author_user = get_user_by('login', 'katestage');
    if (!$author_user) {
        // display_nameで検索
        $users = get_users(array('search' => '*ケイトステージラッシュ*', 'search_columns' => array('display_name')));
        if (!empty($users)) {
            $author_id = $users[0]->ID;
        }
    } else {
        $author_id = $author_user->ID;
    }
    // 見つからなければ現在のユーザー
    if (!$author_id) {
        $author_id = get_current_user_id();
    }

    // 投稿作成
    $post_data = array(
        'post_title'   => $meta['title'],
        'post_content' => $content,
        'post_status'  => 'draft',
        'post_author'  => $author_id,
        'post_name'    => isset($meta['slug']) ? $meta['slug'] : '',
        'post_category' => isset($meta['category']) ? array($meta['category']) : array(27),
    );

    if ($publish_date) {
        $datetime = $publish_date . ' ' . $publish_time . ':00';
        $post_data['post_date'] = $datetime;
        $post_data['post_status'] = 'future';
    }

    $post_id = wp_insert_post($post_data);
    if (is_wp_error($post_id)) {
        return array('error' => $post_id->get_error_message());
    }

    // アイキャッチ設定
    if (isset($featured_image_id)) {
        set_post_thumbnail($post_id, $featured_image_id);
    }

    // AIOSEO メタ設定
    if (!empty($meta['description'])) {
        update_post_meta($post_id, '_aioseo_description', $meta['description']);
    }
    if (!empty($meta['keyword'])) {
        update_post_meta($post_id, '_aioseo_keyphrases', json_encode(array(
            'focus' => array('keyphrase' => $meta['keyword'], 'score' => 0),
            'additional' => array(),
        )));
    }

    return array(
        'success' => true,
        'post_id' => $post_id,
        'title' => $meta['title'],
        'status' => $post_data['post_status'],
        'edit_url' => admin_url("post.php?post={$post_id}&action=edit"),
    );
}

// 管理画面の描画
function kateblog_render_page() {
    // POSTアクション処理
    $message = '';
    if (isset($_POST['kateblog_action']) && check_admin_referer('kateblog_action')) {
        if ($_POST['kateblog_action'] === 'import') {
            $url = sanitize_text_field($_POST['file_url']);
            $date = sanitize_text_field($_POST['publish_date']);
            $time = sanitize_text_field($_POST['publish_time']);
            $result = kateblog_import_article($url, $date, $time ?: '11:00');
            if (isset($result['error'])) {
                $message = '<div class="notice notice-error"><p>エラー: ' . esc_html($result['error']) . '</p></div>';
            } else {
                $message = '<div class="notice notice-success"><p>✅ 投稿完了: <a href="' . esc_url($result['edit_url']) . '">' . esc_html($result['title']) . '</a> (ステータス: ' . esc_html($result['status']) . ')</p></div>';
            }
        }
        if ($_POST['kateblog_action'] === 'run_auto_import') {
            kateblog_auto_import();
            $message = '<div class="notice notice-success"><p>✅ 自動インポートを実行しました。下のログを確認してください。</p></div>';
        }
        if ($_POST['kateblog_action'] === 'reset_imported') {
            update_option('kateblog_imported_files', array());
            $message = '<div class="notice notice-success"><p>インポート済みリストをリセットしました。</p></div>';
        }
        if ($_POST['kateblog_action'] === 'save_settings') {
            update_option('kateblog_github_repo', sanitize_text_field($_POST['kateblog_github_repo']));
            update_option('kateblog_github_branch', sanitize_text_field($_POST['kateblog_github_branch']));
            update_option('kateblog_github_token', sanitize_text_field($_POST['kateblog_github_token']));
            $message = '<div class="notice notice-success"><p>設定を保存しました。</p></div>';
        }
    }

    $files = kateblog_fetch_github_files();
    ?>
    <div class="wrap">
        <h1>KATEBLOG Importer</h1>
        <?php echo $message; ?>

        <h2>GitHub設定</h2>
        <form method="post">
            <?php wp_nonce_field('kateblog_action'); ?>
            <input type="hidden" name="kateblog_action" value="save_settings">
            <table class="form-table">
                <tr><th>リポジトリ</th><td><input type="text" name="kateblog_github_repo" value="<?php echo esc_attr(get_option('kateblog_github_repo', 'tanukichiyamaguchi/KATEBLOG')); ?>" class="regular-text"></td></tr>
                <tr><th>ブランチ</th><td><input type="text" name="kateblog_github_branch" value="<?php echo esc_attr(get_option('kateblog_github_branch', 'claude/blog-automation-system-YsyOB')); ?>" class="regular-text"></td></tr>
                <tr><th>GitHub Token（任意）</th><td><input type="password" name="kateblog_github_token" value="<?php echo esc_attr(get_option('kateblog_github_token', '')); ?>" class="regular-text"><p class="description">プライベートリポジトリの場合に必要</p></td></tr>
            </table>
            <?php submit_button('設定を保存'); ?>
        </form>

        <hr>
        <h2>自動インポート</h2>
        <p>GitHubに新しい記事がプッシュされると、<strong>1時間以内に自動的に下書き保存</strong>されます。<br>
        ブリーフJSONに投稿日が設定されている場合は、予約投稿として保存されます。</p>
        <?php
        $next_run = wp_next_scheduled('kateblog_auto_import_hook');
        $imported = get_option('kateblog_imported_files', array());
        ?>
        <table class="form-table">
            <tr><th>ステータス</th><td><?php echo $next_run ? '✅ 有効（1時間ごと）' : '❌ 無効'; ?></td></tr>
            <tr><th>次回実行</th><td><?php echo $next_run ? date('Y-m-d H:i:s', $next_run + get_option('gmt_offset') * 3600) : '-'; ?></td></tr>
            <tr><th>インポート済み</th><td><?php echo count($imported); ?>本 <?php if (!empty($imported)): ?><details><summary>詳細</summary><ul><?php foreach ($imported as $f) echo '<li>' . esc_html($f) . '</li>'; ?></ul></details><?php endif; ?></td></tr>
        </table>

        <form method="post" style="margin-bottom:20px;">
            <?php wp_nonce_field('kateblog_action'); ?>
            <input type="hidden" name="kateblog_action" value="run_auto_import">
            <button type="submit" class="button button-secondary">今すぐ自動インポートを実行</button>
            <button type="submit" name="kateblog_action" value="reset_imported" class="button" onclick="return confirm('インポート済みリストをリセットしますか？');">インポート済みリストをリセット</button>
        </form>

        <?php
        $log = get_option('kateblog_import_log', array());
        if (!empty($log)): ?>
            <h3>インポートログ</h3>
            <div style="max-height:300px;overflow-y:auto;background:#f9f9f9;padding:10px;border:1px solid #ddd;">
            <?php foreach (array_reverse($log) as $entry): ?>
                <p><strong><?php echo esc_html($entry['date']); ?></strong></p>
                <ul>
                <?php foreach ($entry['entries'] as $line): ?>
                    <li><?php echo esc_html($line); ?></li>
                <?php endforeach; ?>
                </ul>
            <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <hr>
        <h2>手動インポート（GitHub output/）</h2>
        <?php if (isset($files['error'])): ?>
            <div class="notice notice-error"><p><?php echo esc_html($files['error']); ?></p></div>
        <?php elseif (empty($files)): ?>
            <p>outputディレクトリにHTMLファイルがありません。</p>
        <?php else: ?>
            <table class="wp-list-table widefat fixed striped">
                <thead><tr><th>ファイル名</th><th>投稿日（空欄＝下書き）</th><th>時刻</th><th>操作</th></tr></thead>
                <tbody>
                <?php foreach ($files as $file): ?>
                    <tr>
                        <td><?php echo esc_html($file['name']); ?></td>
                        <td>
                            <form method="post" style="display:inline;">
                                <?php wp_nonce_field('kateblog_action'); ?>
                                <input type="hidden" name="kateblog_action" value="import">
                                <input type="hidden" name="file_url" value="<?php echo esc_attr($file['download_url']); ?>">
                                <input type="date" name="publish_date" value="" style="width:150px;">
                        </td>
                        <td><input type="text" name="publish_time" value="11:00" style="width:80px;"></td>
                        <td><button type="submit" class="button button-primary">インポート</button></form></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
    </div>
    <?php
}
