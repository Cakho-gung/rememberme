import Mention from '@tiptap/extension-mention';

const suggestion = {
	char: '@',
	// Trả về chính query để suggestion engine luôn hoạt động
	items: ({ query }: { query: string }) => [query],
	render: () => {
		let currentProps: any;

		return {
			onStart: (props: any) => {
				currentProps = props;
			},
			onUpdate: (props: any) => {
				currentProps = props;
			},
			onKeyDown: (props: any) => {
				// Bắt sự kiện phím Space hoặc Enter để chốt Tag
				if (props.event.key === ' ' || props.event.key === 'Enter') {
					const query = currentProps.query;
					
					// Nếu có gõ chữ sau dấu @
					if (query && query.trim().length > 0) {
						props.event.preventDefault();
						
						// Replace đoạn text @... thành Node Mention
						currentProps.command({ id: query, label: query });
						
						// Nếu bấm Space, tự động thêm một khoảng trắng sau cái tag để gõ tiếp
						if (props.event.key === ' ') {
							setTimeout(() => {
								currentProps.editor.commands.insertContent(' ');
							}, 0);
						}
						
						return true;
					}
				}
				
				// Nếu nhấn backspace mà xóa hết chữ, chỉ còn @, kệ nó
				return false;
			},
			onExit: () => {
				// Không cần dọn dẹp UI vì ta không render popup
			},
		};
	},
};

export const MentionExtension = Mention.configure({
	HTMLAttributes: {
		class: 'mention-tag',
	},
	suggestion,
});
